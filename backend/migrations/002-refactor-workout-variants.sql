-- migrations/002-refactor-workout-variants.sql
-- Refatoração: provas com variantes por categoria + correções de ranking
--
-- CONTEXTO DA MUDANÇA
-- Cada categoria (Iniciante/Scale/RX × Masculino/Feminino/Misto) executa a mesma
-- prova com cargas e movimentos diferentes. Modelar isso como workouts separados
-- por categoria quebraria o cronograma do evento: não haveria como saber que a
-- "Prova 1" de Iniciante Masculino e a de RX Misto acontecem no mesmo bloco.
--
-- Solução: a prova (workouts) é uma só por campeonato; a descrição que muda por
-- categoria vive em workout_variants.

BEGIN;

-- ============================================================================
-- 1. WORKOUTS: separar a prova (conceito) da variante (execução por categoria)
-- ============================================================================

ALTER TABLE workouts ADD COLUMN IF NOT EXISTS name VARCHAR(255);

COMMENT ON COLUMN workouts.description IS
  'Nota geral da prova (opcional). A descrição que vale para cada categoria está em workout_variants.description.';

CREATE TABLE IF NOT EXISTS workout_variants (
  id SERIAL PRIMARY KEY,
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  time_cap_seconds INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workout_id, category_id)
);

-- Dados existentes: replica a description atual como variante de cada categoria
-- do campeonato, para não perder o que já foi cadastrado.
INSERT INTO workout_variants (workout_id, category_id, description)
SELECT w.id, c.id, w.description
FROM workouts w
JOIN categories c ON c.championship_id = w.championship_id
WHERE w.description IS NOT NULL AND w.description <> ''
ON CONFLICT (workout_id, category_id) DO NOTHING;

-- ============================================================================
-- 2. TEAMS: permitir mesmo nome em categorias diferentes
-- ============================================================================
-- A constraint antiga UNIQUE(championship_id, name) impedia "Equipe Alpha" de
-- existir em Iniciante Masculino e em RX Misto ao mesmo tempo. A unicidade
-- correta é dentro da categoria, não do campeonato.

ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_championship_id_name_key;

-- DROP + ADD, não só ADD: sem o DROP IF EXISTS daqui, rodar esta migration
-- uma segunda vez (banco já migrado) falha com "constraint already exists" —
-- e como todo o arquivo está dentro de um BEGIN/COMMIT só, esse erro reverte
-- também o CREATE OR REPLACE FUNCTION recalculate_standings mais abaixo,
-- mesmo ele tendo rodado sem problema. Resultado: a função volta pra versão
-- antiga (migration 001, sem PARTITION BY category_id) só porque um ADD
-- CONSTRAINT no meio do arquivo não era idempotente. Bug real, encontrado
-- rodando scripts/migrate.js duas vezes seguidas contra o mesmo banco.
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_championship_category_name_key;

ALTER TABLE teams ADD CONSTRAINT teams_championship_category_name_key
  UNIQUE (championship_id, category_id, name);

-- ============================================================================
-- 3. TEAM_STANDINGS: ranking é por categoria, não por campeonato
-- ============================================================================
-- Comparar a pontuação de Iniciante Feminino com RX Misto não faz sentido:
-- provas diferentes, cargas diferentes. Cada categoria tem seu próprio pódio.

ALTER TABLE team_standings
  ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE;

UPDATE team_standings ts
SET category_id = t.category_id
FROM teams t
WHERE t.id = ts.team_id AND ts.category_id IS NULL;

ALTER TABLE team_standings ALTER COLUMN category_id SET NOT NULL;

-- ============================================================================
-- 4. ÍNDICES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_workout_variants_workout ON workout_variants(workout_id);
CREATE INDEX IF NOT EXISTS idx_workout_variants_category ON workout_variants(category_id);
CREATE INDEX IF NOT EXISTS idx_teams_category ON teams(category_id);
CREATE INDEX IF NOT EXISTS idx_heats_workout_category ON heats(workout_id, category_id);
CREATE INDEX IF NOT EXISTS idx_team_standings_category_place ON team_standings(category_id, "place");

-- ============================================================================
-- 5. RECALCULATE_STANDINGS: dois bugs corrigidos
-- ============================================================================
-- Bug 1: ROW_NUMBER() sem PARTITION BY category_id rankeava todas as categorias
--        numa lista só.
-- Bug 2: equipe sem nenhum resultado entrava com total_score = 0 e, como a
--        ordenação é ASC (soma de colocações, menor é melhor), liderava o
--        campeonato sem ter competido.

CREATE OR REPLACE FUNCTION recalculate_standings(p_championship_id INTEGER)
RETURNS void AS $$
BEGIN
  DELETE FROM team_standings WHERE championship_id = p_championship_id;

  INSERT INTO team_standings (championship_id, category_id, team_id, total_score, workouts_completed)
  SELECT
    t.championship_id,
    t.category_id,
    t.id,
    COALESCE(SUM(r."place"), 0) AS total_score,
    COUNT(DISTINCT h.workout_id) FILTER (WHERE r.id IS NOT NULL) AS workouts_completed
  FROM teams t
  LEFT JOIN heat_teams ht ON ht.team_id = t.id
  LEFT JOIN heats h ON h.id = ht.heat_id
  LEFT JOIN results r ON r.heat_team_id = ht.id
  WHERE t.championship_id = p_championship_id
  GROUP BY t.championship_id, t.category_id, t.id;

  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY category_id
        ORDER BY
          (workouts_completed = 0),  -- false (competiu) vem antes de true
          total_score ASC,
          team_id ASC                -- desempate determinístico
      ) AS new_place
    FROM team_standings
    WHERE championship_id = p_championship_id
  )
  UPDATE team_standings ts
  SET "place" = r.new_place, updated_at = CURRENT_TIMESTAMP
  FROM ranked r
  WHERE ts.id = r.id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. TRIGGER: também disparar no DELETE de resultado
-- ============================================================================
-- O trigger antigo só cobria INSERT e UPDATE. Apagar um resultado lançado por
-- engano deixava o ranking desatualizado até a próxima inserção.

CREATE OR REPLACE FUNCTION trigger_result_changed()
RETURNS TRIGGER AS $$
DECLARE
  v_championship_id INTEGER;
  v_heat_team_id INTEGER;
BEGIN
  v_heat_team_id := COALESCE(NEW.heat_team_id, OLD.heat_team_id);

  SELECT w.championship_id INTO v_championship_id
  FROM heat_teams ht
  JOIN heats h ON h.id = ht.heat_id
  JOIN workouts w ON w.id = h.workout_id
  WHERE ht.id = v_heat_team_id;

  IF v_championship_id IS NOT NULL THEN
    PERFORM recalculate_standings(v_championship_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_result_inserted ON results;
DROP TRIGGER IF EXISTS trg_result_changed ON results;

CREATE TRIGGER trg_result_changed
  AFTER INSERT OR UPDATE OR DELETE ON results
  FOR EACH ROW
  EXECUTE FUNCTION trigger_result_changed();

DROP FUNCTION IF EXISTS trigger_result_inserted();

COMMIT;
