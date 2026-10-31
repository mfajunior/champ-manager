-- migrations/019-tiebreak-somente-no-tempo.sql
-- O desempate vale só para a pontuação de TEMPO.
--
-- O QUE ESTAVA ERRADO
--
-- Na 014, o ORDER BY de recalculate_placements testava o scoring_type para
-- decidir a direção do raw_value (menor vence no tempo, maior vence em reps e
-- carga), mas a linha do desempate ficou fora desse teste:
--
--     r.tiebreak_seconds ASC NULLS LAST
--
-- Numa prova de duas pontuações, as duas linhas de resultado (score_index 1 e
-- 2) passam pelo mesmo ORDER BY, então o desempate era aplicado nas duas.
--
-- POR QUE ISSO IMPORTA
--
-- O tiebreak do CrossFit é um tempo parcial anotado durante o WOD. Ele
-- desempata quem chegou ao mesmo resultado no relógio — faz sentido na
-- pontuação de tempo e não tem significado na de repetições ou carga. Duas
-- equipes com as MESMAS reps devem dividir a colocação, com o RANK() dando 2º
-- às duas e pulando para o 4º. Com o desempate aplicado ali, elas saíam 2º e
-- 3º, ordenadas por um tempo parcial que não diz nada sobre quem fez mais
-- repetições. Muda pontos, e pode decidir pódio.
--
-- A CORREÇÃO
--
-- O mesmo CASE que já decide a direção passa a cercar o desempate. Quando o
-- score_index não é de tempo, o CASE devolve NULL para todas as linhas — e uma
-- coluna de ordenação inteiramente nula não reordena nada, deixando o RANK()
-- devolver o empate verdadeiro.
--
-- Função recalculada do zero a cada mudança de resultado, então aplicar esta
-- migration e disparar um recálculo corrige retroativamente o que já foi
-- lançado: não há dado a migrar.

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
          -- Desempate SÓ na pontuação de tempo: tempo parcial não diz nada
          -- sobre quem fez mais repetições ou levantou mais carga.
          CASE WHEN COALESCE(
                 CASE WHEN r.score_index = 1 THEN t.tipo_1 ELSE t.tipo_2 END,
                 'time') = 'time'
               THEN r.tiebreak_seconds END ASC NULLS LAST
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
