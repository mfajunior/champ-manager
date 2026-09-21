const { queryAll } = require('../config/database');

/**
 * A consulta do ranking de um campeonato, num lugar só.
 *
 * POR QUE ISSO EXISTE
 * Esta query vivia duplicada: uma cópia em leaderboardController (a resposta
 * de GET /api/leaderboard) e outra em resultController.broadcastLeaderboard
 * (o payload empurrado pelo WebSocket a cada resultado). São o MESMO dado,
 * consumido pela MESMA tela — o placar público faz a busca inicial por HTTP
 * e recebe as atualizações seguintes pelo socket, jogando as duas no mesmo
 * cache do React Query (frontend/src/hooks/useLeaderboard.ts).
 *
 * Duas cópias significam duas chances de corrigir só uma. Foi o que
 * aconteceu: quando a consulta passou a partir de `teams` com LEFT JOIN em
 * team_standings (pra equipe sem resultado ainda aparecer no placar), só a
 * do controller foi corrigida. A do broadcast continuou partindo de
 * team_standings com INNER JOIN e sem gender/level — então o mesmo cache
 * recebia dois formatos diferentes de linha, dependendo de ter vindo do GET
 * ou do socket. Não quebrava a tela porque nada lê gender/level hoje, que é
 * exatamente o tipo de bug que espera meses pra aparecer.
 *
 * DECISÕES DA QUERY (herdadas da versão correta, do leaderboardController)
 * - Parte de `teams`, não de `team_standings`: a tabela de standings é cache
 *   escrito pelo trigger trg_result_changed, então antes do primeiro
 *   resultado do campeonato ela está vazia mesmo com equipes cadastradas.
 *   Com LEFT JOIN, toda equipe inscrita aparece desde já.
 * - COALESCE em total_score/workouts_completed: sem linha no cache, 0 é a
 *   resposta honesta. `place` NÃO recebe COALESCE de propósito — null ali
 *   significa "ainda não pontuou", e 0 fingiria uma colocação que não existe.
 * - A ordenação empurra quem tem place null pro fim de cada categoria
 *   ((ts.place IS NULL) ASC) e desempata por nome, pra lista não dançar
 *   entre dois carregamentos.
 *
 * @param {number|string} championshipId
 * @param {number|string|null} categoryId  null traz todas as categorias.
 */
const fetchStandings = (championshipId, categoryId = null) =>
  queryAll(
    `SELECT t.id AS team_id, t.name AS team_name,
            c.id AS category_id, c.name AS category_name, c.gender, c.level,
            COALESCE(ts.total_score, 0) AS total_score,
            ts."place",
            COALESCE(ts.workouts_completed, 0) AS workouts_completed,
            ts.updated_at
     FROM teams t
     JOIN categories c ON c.id = t.category_id
     LEFT JOIN team_standings ts ON ts.team_id = t.id AND ts.championship_id = t.championship_id
     WHERE t.championship_id = $1
       AND ($2::int IS NULL OR t.category_id = $2::int)
     ORDER BY c.id ASC, (ts."place" IS NULL) ASC, ts."place" ASC, t.name ASC`,
    [championshipId, categoryId || null]
  );

module.exports = { fetchStandings };
