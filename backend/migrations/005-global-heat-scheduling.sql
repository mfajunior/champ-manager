-- migrations/005-global-heat-scheduling.sql
-- Baterias deixam de pertencer a uma única categoria: agora podem misturar
-- categorias diferentes na mesma bateria, preenchendo raia por raia numa
-- ordem fixa (nível: iniciante -> scale -> rx; dentro do nível: feminino ->
-- masculino -> misto — ver heatController.generate). Isso substitui os
-- parâmetros category_id/lanes_per_heat por chamada por um conjunto de
-- parâmetros GLOBAIS do campeonato: número de raias, tempo de transição entre
-- baterias e hora de início — usados pra calcular a hora exata de cada
-- bateria a partir do time cap de cada prova/categoria (workout_variants).

BEGIN;

-- ============================================================================
-- 1. CHAMPIONSHIPS: parâmetros globais de agenda
-- ============================================================================
ALTER TABLE championships ADD COLUMN IF NOT EXISTS lanes_per_heat INTEGER;
ALTER TABLE championships ADD COLUMN IF NOT EXISTS transition_seconds INTEGER;
ALTER TABLE championships ADD COLUMN IF NOT EXISTS start_time TIME;

ALTER TABLE championships DROP CONSTRAINT IF EXISTS championships_lanes_per_heat_check;
ALTER TABLE championships ADD CONSTRAINT championships_lanes_per_heat_check
  CHECK (lanes_per_heat IS NULL OR lanes_per_heat > 0);

ALTER TABLE championships DROP CONSTRAINT IF EXISTS championships_transition_seconds_check;
ALTER TABLE championships ADD CONSTRAINT championships_transition_seconds_check
  CHECK (transition_seconds IS NULL OR transition_seconds >= 0);

-- ============================================================================
-- 2. HEATS: uma bateria não pertence mais a uma única categoria
-- ============================================================================
-- Dado existente apagado de propósito (autorizado pelo Milton): sob o modelo
-- antigo, uma bateria só podia ter uma categoria — não há como migrar isso
-- pro modelo novo (bateria mista) sem inventar uma ordem que nunca existiu.
-- DELETE (não TRUNCATE): precisa disparar o trigger de results pra zerar
-- team_standings corretamente — TRUNCATE não dispara trigger por linha, e
-- team_standings não tem FK direta pra heats/heat_teams/results pra herdar
-- isso de outro jeito.
DELETE FROM heats;

ALTER TABLE heats DROP CONSTRAINT IF EXISTS heats_workout_id_heat_number_category_id_key;
ALTER TABLE heats DROP COLUMN IF EXISTS category_id;

ALTER TABLE heats DROP CONSTRAINT IF EXISTS heats_workout_id_heat_number_key;
ALTER TABLE heats ADD CONSTRAINT heats_workout_id_heat_number_key UNIQUE (workout_id, heat_number);

-- Duração calculada da bateria (maior time cap entre as categorias
-- presentes nela, na prova em questão). Guardada na própria linha em vez de
-- recalculada toda vez: é o que permite encadear o horário da PRÓXIMA prova
-- gerada a partir de onde a agenda já calculada termina, sem re-consultar
-- workout_variants de provas antigas. NULL quando alguma categoria presente
-- na bateria não tem time cap definido — nesse caso o horário dela e de
-- todas as baterias seguintes também fica NULL (não dá pra encadear um
-- horário sem saber quando a bateria anterior termina).
ALTER TABLE heats ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

-- ============================================================================
-- 3. FUNÇÕES QUE LIAM CATEGORIA PELA BATERIA (h.category_id) — agora a
--    categoria de uma equipe é sempre lida da própria equipe (t.category_id),
--    nunca da bateria, porque a bateria pode misturar categorias.
-- ============================================================================
-- Sem este ajuste, QUALQUER lançamento de resultado quebra a partir daqui:
-- recalculate_placements e o trigger trigger_result_changed (que dispara em
-- todo INSERT/UPDATE/DELETE de results, ver migration 002/003) ainda liam
-- h.category_id pra saber a categoria da equipe pra ranquear — e essa coluna
-- acabou de ser apagada acima. Corrigido pra ler t.category_id (via JOIN em
-- teams, que já está no caminho ht -> heats -> ... -> teams) em vez disso.
-- O comportamento não muda: uma equipe sempre teve categoria fixa (teams.
-- category_id), então ranquear por t.category_id em vez de h.category_id dá
-- exatamente o mesmo resultado de antes, só que sem depender de uma coluna
-- que não existe mais.

CREATE OR REPLACE FUNCTION recalculate_placements(p_workout_id INTEGER, p_category_id INTEGER)
RETURNS void AS $$
DECLARE
  v_scoring_type VARCHAR(10);
BEGIN
  SELECT scoring_type INTO v_scoring_type FROM workouts WHERE id = p_workout_id;

  WITH ranked AS (
    SELECT
      r.id,
      RANK() OVER (
        ORDER BY
          r.did_not_finish ASC,                                      -- false antes de true
          CASE WHEN v_scoring_type = 'time' THEN r.raw_value END ASC,      -- menor tempo vence
          CASE WHEN v_scoring_type IN ('reps', 'load') THEN r.raw_value END DESC  -- maior vence
      ) AS new_place
    FROM results r
    JOIN heat_teams ht ON ht.id = r.heat_team_id
    JOIN heats h ON h.id = ht.heat_id
    JOIN teams t ON t.id = ht.team_id
    WHERE h.workout_id = p_workout_id AND t.category_id = p_category_id
  )
  UPDATE results res
  SET "place" = ranked.new_place
  FROM ranked
  WHERE res.id = ranked.id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trigger_result_changed()
RETURNS TRIGGER AS $$
DECLARE
  v_championship_id INTEGER;
  v_workout_id INTEGER;
  v_category_id INTEGER;
  v_heat_team_id INTEGER;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_heat_team_id := COALESCE(NEW.heat_team_id, OLD.heat_team_id);

  SELECT w.championship_id, w.id, t.category_id
    INTO v_championship_id, v_workout_id, v_category_id
  FROM heat_teams ht
  JOIN heats h ON h.id = ht.heat_id
  JOIN workouts w ON w.id = h.workout_id
  JOIN teams t ON t.id = ht.team_id
  WHERE ht.id = v_heat_team_id;

  IF v_workout_id IS NOT NULL THEN
    PERFORM recalculate_placements(v_workout_id, v_category_id);
    PERFORM recalculate_standings(v_championship_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

COMMIT;
