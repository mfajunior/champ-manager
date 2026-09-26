-- migrations/014-two-scores-and-tiebreak.sql
-- Duas coisas que mudam como uma prova é pontuada.
--
-- =========================================================================
-- 1. PROVA COM DUAS PONTUAÇÕES
-- =========================================================================
-- Uma prova pode ter duas pontuações independentes — por exemplo, tempo no
-- primeiro bloco e carga máxima no segundo. Cada uma tem a SUA colocação, e
-- uma não depende da outra: a equipe pode ser 1ª numa e última na outra.
--
-- A DECISÃO DE MODELAGEM
--
-- Em vez de results.raw_value_2 / place_2, cada pontuação vira uma LINHA em
-- results, identificada por score_index. Parece mais trabalho e é menos.
--
-- Com colunas, toda soma do placar teria que aprender a existência da segunda
-- pontuação: recalculate_standings, recalculate_points_standings, o desempate
-- por ARRAY_AGG das colocações, o histórico. Seriam quatro lugares para mudar
-- e quatro para esquecer.
--
-- Com linhas, o comportamento pedido — "as duas pontuações são independentes
-- e a prova vale o dobro no placar" — sai de graça: SUM(place) e
-- SUM(points_for_place(place)) já somam todas as linhas de resultado da
-- equipe. Nenhuma das funções de standings muda uma vírgula. Só o cálculo da
-- COLOCAÇÃO precisa saber de score_index, porque ranquear é justamente a
-- operação que separa uma pontuação da outra.
--
-- O preço é trocar UNIQUE(heat_team_id) por UNIQUE(heat_team_id, score_index).
-- A garantia antiga continua valendo para quem tem uma pontuação só.

ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS scoring_type_2 VARCHAR(10) NULL;

ALTER TABLE workouts DROP CONSTRAINT IF EXISTS chk_scoring_type_2;
ALTER TABLE workouts ADD CONSTRAINT chk_scoring_type_2
  CHECK (scoring_type_2 IS NULL OR scoring_type_2 IN ('time', 'reps', 'load'));

ALTER TABLE results
  ADD COLUMN IF NOT EXISTS score_index SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE results DROP CONSTRAINT IF EXISTS chk_score_index;
ALTER TABLE results ADD CONSTRAINT chk_score_index
  CHECK (score_index IN (1, 2));

-- A unicidade passa a ser por pontuação. Os resultados que já existem ficaram
-- todos com score_index = 1 pelo DEFAULT, então nada muda para eles.
ALTER TABLE results DROP CONSTRAINT IF EXISTS results_heat_team_id_key;
ALTER TABLE results DROP CONSTRAINT IF EXISTS results_heat_team_score_key;
ALTER TABLE results ADD CONSTRAINT results_heat_team_score_key
  UNIQUE (heat_team_id, score_index);

-- =========================================================================
-- 2. DESEMPATE (TIE BREAKER)
-- =========================================================================
-- Prova de vários rounds pode usar o tempo de um round como critério de
-- desempate. Não aparece no placar e não vale pontos: serve só para ordenar
-- quem empatou na pontuação principal.
--
-- Guardado em segundos, menor é melhor — é sempre um tempo. Fica em results e
-- não em heat_teams porque é lançado junto com o resultado, pelo mesmo
-- organizador, no mesmo momento.
--
-- Quando a prova tem duas pontuações, o mesmo tempo de desempate vale para as
-- duas: é um fato físico da execução da equipe naquela prova, não uma
-- propriedade de uma das pontuações. Por isso a coluna é preenchida nas duas
-- linhas quando o resultado é lançado.

ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS has_tiebreak BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE results
  ADD COLUMN IF NOT EXISTS tiebreak_seconds NUMERIC(10,2) NULL;

ALTER TABLE results DROP CONSTRAINT IF EXISTS chk_tiebreak_positive;
ALTER TABLE results ADD CONSTRAINT chk_tiebreak_positive
  CHECK (tiebreak_seconds IS NULL OR tiebreak_seconds >= 0);

CREATE INDEX IF NOT EXISTS idx_results_heat_team_score
  ON results(heat_team_id, score_index);

-- =========================================================================
-- 3. RECALCULATE_PLACEMENTS: ranqueia CADA pontuação separadamente
-- =========================================================================
-- Três mudanças sobre a versão da migration 005:
--
--   a) PARTITION BY r.score_index — cada pontuação tem o seu ranking. É o que
--      torna as duas independentes.
--   b) O tipo de pontuação passa a depender do índice: scoring_type para a
--      primeira, scoring_type_2 para a segunda. Uma prova pode ser tempo numa
--      e carga na outra.
--   c) O desempate entra no fim do ORDER BY, com NULLS LAST: quem não teve o
--      tempo de desempate lançado não é premiado por isso.
--
-- RANK() continua: empate divide a colocação e pula a seguinte (1-2-2-4), que
-- é o que os dois modelos de pontuação esperam.
CREATE OR REPLACE FUNCTION recalculate_placements(p_workout_id INTEGER, p_category_id INTEGER)
RETURNS void AS $$
BEGIN
  WITH tipos AS (
    SELECT w.scoring_type AS tipo_1, w.scoring_type_2 AS tipo_2
      FROM workouts w WHERE w.id = p_workout_id
  ),
  ranked AS (
    SELECT
      r.id,
      RANK() OVER (
        PARTITION BY r.score_index
        ORDER BY
          r.did_not_finish ASC,                                    -- false antes de true
          CASE WHEN COALESCE(
                 CASE WHEN r.score_index = 1 THEN t.tipo_1 ELSE t.tipo_2 END,
                 'time') = 'time'
               THEN r.raw_value END ASC,                           -- menor tempo vence
          CASE WHEN COALESCE(
                 CASE WHEN r.score_index = 1 THEN t.tipo_1 ELSE t.tipo_2 END,
                 'time') IN ('reps', 'load')
               THEN r.raw_value END DESC,                          -- maior vence
          r.tiebreak_seconds ASC NULLS LAST                        -- desempate
      ) AS new_place
    FROM results r
    CROSS JOIN tipos t
    JOIN heat_teams ht ON ht.id = r.heat_team_id
    JOIN heats h ON h.id = ht.heat_id
    JOIN teams tm ON tm.id = ht.team_id
    WHERE h.workout_id = p_workout_id AND tm.category_id = p_category_id
  )
  UPDATE results res
  SET "place" = ranked.new_place
  FROM ranked
  WHERE res.id = ranked.id;
END;
$$ LANGUAGE plpgsql;
