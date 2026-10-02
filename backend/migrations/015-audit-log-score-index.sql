-- migrations/015-audit-log-score-index.sql
-- Guarda no histórico QUAL das duas pontuações cada lançamento alterou.
--
-- CONTEXTO
-- A migration 014 deu duas pontuações à mesma raia (results.score_index 1 e
-- 2), mas o result_audit_log ficou como estava: ele é consultado por
-- heat_team_id, então uma prova de duas pontuações passou a devolver as duas
-- histórias misturadas, sem nada que diga qual linha é de qual pontuação.
--
-- Isso não é só cosmético. O histórico existe para contestação: o organizador
-- abre a tela quando uma equipe reclama de um resultado. Duas correções na
-- mesma raia, no mesmo minuto, com valores diferentes e sem dizer a qual
-- pontuação pertencem, é exatamente o que a tela deveria evitar. Pior: a tela
-- formatava tudo com o tipo da PRIMEIRA pontuação, então 180 repetições
-- apareciam como "03:00".
--
-- POR QUE UMA COLUNA E NÃO UM JOIN COM results
-- O log sobrevive ao resultado: result_id usa ON DELETE SET NULL (migration
-- 004), de propósito, para que a linha 'deleted' não desapareça junto com o
-- que ela registra. Um JOIN com results, portanto, perderia o índice
-- justamente nas linhas de remoção — as mais relevantes numa contestação. A
-- informação precisa ser copiada para o log no momento da escrita.

BEGIN;

-- DEFAULT 1 cobre o passado inteiro: até a migration 014 toda raia tinha uma
-- pontuação só, e todo histórico já gravado é dela.
ALTER TABLE result_audit_log
  ADD COLUMN IF NOT EXISTS score_index SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE result_audit_log
  DROP CONSTRAINT IF EXISTS result_audit_log_score_index_check;

ALTER TABLE result_audit_log
  ADD CONSTRAINT result_audit_log_score_index_check
  CHECK (score_index IN (1, 2));

-- Backfill do que ainda tem resultado vivo. As linhas cujo result_id já é
-- NULL (resultado apagado) ficam com 1 — e estão certas: só existem linhas
-- assim de antes da 014, quando 1 era o único índice possível.
UPDATE result_audit_log ral
   SET score_index = r.score_index
  FROM results r
 WHERE r.id = ral.result_id
   AND ral.score_index IS DISTINCT FROM r.score_index;

COMMIT;
