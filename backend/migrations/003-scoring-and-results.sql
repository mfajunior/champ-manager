-- migrations/003-scoring-and-results.sql
-- Pontuação calculada pelo sistema: o organizador lança o desempenho bruto
-- (tempo, reps ou carga) e o place é derivado, nunca digitado.

BEGIN;

-- ============================================================================
-- 1. WORKOUTS: como interpretar o valor bruto de cada prova
-- ============================================================================
-- 'time' -> menor vence (for_time)
-- 'reps' -> maior vence (amrap)
-- 'load' -> maior vence (lpo, carga levantada em kg)

ALTER TABLE workouts ADD COLUMN IF NOT EXISTS scoring_type VARCHAR(10) NOT NULL DEFAULT 'time';

ALTER TABLE workouts DROP CONSTRAINT IF EXISTS workouts_scoring_type_check;
ALTER TABLE workouts ADD CONSTRAINT workouts_scoring_type_check
  CHECK (scoring_type IN ('time', 'reps', 'load'));

-- ============================================================================
-- 2. RESULTS: valor bruto numérico em vez de texto livre
-- ============================================================================
-- time_or_reps era uma string ("12:34", "45 reps") — impossível de ordenar
-- numericamente entre tipos de prova diferentes. raw_value guarda sempre um
-- número: segundos (time), repetições (reps) ou quilos (load).

ALTER TABLE results ADD COLUMN IF NOT EXISTS raw_value NUMERIC(10,2);
ALTER TABLE results ADD COLUMN IF NOT EXISTS did_not_finish BOOLEAN NOT NULL DEFAULT FALSE;

-- place deixa de ser obrigatório no INSERT: é calculado depois, por
-- recalculate_placements, nunca digitado pelo organizador.
ALTER TABLE results ALTER COLUMN "place" DROP NOT NULL;

ALTER TABLE results DROP COLUMN IF EXISTS time_or_reps;

-- Ou tem valor bruto, ou está marcado como DNF — nunca os dois nem nenhum dos dois.
ALTER TABLE results DROP CONSTRAINT IF EXISTS results_value_or_dnf;
ALTER TABLE results ADD CONSTRAINT results_value_or_dnf
  CHECK (
    (did_not_finish = FALSE AND raw_value IS NOT NULL) OR
    (did_not_finish = TRUE  AND raw_value IS NULL)
  );

-- ============================================================================
-- 3. RECALCULATE_PLACEMENTS: calcula o place a partir do raw_value
-- ============================================================================
-- RANK() e não ROW_NUMBER(): dois tempos iguais dividem a posição
-- (1º, 1º, 3º) — a próxima colocação pula, como em qualquer campeonato real.
-- DNF sempre fica atrás de qualquer resultado válido, não importa o scoring_type.

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
    WHERE h.workout_id = p_workout_id AND h.category_id = p_category_id
  )
  UPDATE results res
  SET "place" = ranked.new_place
  FROM ranked
  WHERE res.id = ranked.id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. TRIGGER: recalcula placement da categoria E standings do campeonato
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_result_changed()
RETURNS TRIGGER AS $$
DECLARE
  v_championship_id INTEGER;
  v_workout_id INTEGER;
  v_category_id INTEGER;
  v_heat_team_id INTEGER;
BEGIN
  -- recalculate_placements faz um UPDATE em results para gravar o place
  -- calculado, e esse UPDATE dispara este mesmo trigger de novo. Sem esta
  -- trava, é recursão infinita até estourar a pilha do Postgres.
  -- pg_trigger_depth() > 1 significa "já estou dentro de uma chamada
  -- recursiva deste trigger" — nesse caso não há nada novo a recalcular.
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_heat_team_id := COALESCE(NEW.heat_team_id, OLD.heat_team_id);

  SELECT w.championship_id, w.id, h.category_id
    INTO v_championship_id, v_workout_id, v_category_id
  FROM heat_teams ht
  JOIN heats h ON h.id = ht.heat_id
  JOIN workouts w ON w.id = h.workout_id
  WHERE ht.id = v_heat_team_id;

  IF v_workout_id IS NOT NULL THEN
    PERFORM recalculate_placements(v_workout_id, v_category_id);
    PERFORM recalculate_standings(v_championship_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- trigger já existente (trg_result_changed, criado na migration 002) continua
-- válido: só a função por trás dele mudou.

COMMIT;
