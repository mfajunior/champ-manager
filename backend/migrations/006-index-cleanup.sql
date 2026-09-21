-- migrations/006-index-cleanup.sql
-- Um índice que faltava e dois que sobravam.
--
-- Nada aqui muda dado nem comportamento: só o plano de execução das queries.
-- Tudo é reversível com um CREATE INDEX / DROP INDEX, e os IF EXISTS /
-- IF NOT EXISTS deixam a migration segura mesmo num banco onde alguém já
-- tenha mexido nesses índices à mão.

BEGIN;

-- ============================================================================
-- 1. FALTAVA: heat_teams.team_id
-- ============================================================================
-- heat_teams tem dois índices (idx_heat_teams_heat e o UNIQUE(heat_id,
-- team_id) da migration 001) e os dois começam por heat_id — nenhum serve
-- para uma busca que parte do team_id, que cai em varredura da tabela.
--
-- Quem busca assim:
--   - teamController.getResults: a subquery "WHERE ht.team_id = $2", usada
--     toda vez que alguém abre o detalhamento de uma equipe no placar;
--   - recalculate_standings e recalculate_placements (migrations 002/005):
--     as duas fazem JOIN partindo de teams -> heat_teams, e rodam via
--     trigger a CADA resultado lançado, corrigido ou apagado. É o caminho
--     mais quente do sistema durante um evento ao vivo.
CREATE INDEX IF NOT EXISTS idx_heat_teams_team ON heat_teams(team_id);

-- ============================================================================
-- 2. SOBRAVA: results(heat_team_id)
-- ============================================================================
-- results já tem UNIQUE(heat_team_id) desde a migration 001, e uma
-- constraint UNIQUE cria seu próprio índice — este aqui é uma segunda cópia
-- da mesma coisa, que só custa escrita a cada INSERT/UPDATE em results.
-- (O nome também nunca bateu com o conteúdo: fala em championship e indexa
-- heat_team_id.)
DROP INDEX IF EXISTS idx_results_championship;

-- ============================================================================
-- 3. SOBRAVA: heats(workout_id)
-- ============================================================================
-- A migration 005 recriou heats_workout_id_heat_number_key
-- UNIQUE(workout_id, heat_number). Um índice composto atende as buscas pelo
-- seu prefixo à esquerda, então workout_id sozinho já está coberto.
DROP INDEX IF EXISTS idx_heats_workout;

COMMIT;
