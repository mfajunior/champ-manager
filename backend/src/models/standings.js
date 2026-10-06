const { queryAll } = require('../config/database');

/**
 * A consulta do ranking de um campeonato, num lugar só.
 *
 * Dois caminhos entregam o MESMO dado à MESMA tela: o GET /api/leaderboard e o
 * payload que o WebSocket empurra a cada resultado. O placar público faz a
 * busca inicial por HTTP e recebe o resto pelo socket, jogando as duas no
 * mesmo cache do React Query (frontend/src/hooks/useLeaderboard.ts). Enquanto
 * a query estava duplicada, uma cópia foi corrigida e a outra não, e o mesmo
 * cache passou a receber dois formatos de linha dependendo da origem — sem
 * quebrar a tela, porque nada lia os campos que faltavam. É o tipo de bug que
 * espera meses para aparecer.
 *
 * DECISÕES DA QUERY
 * - Parte de `teams`, não de `team_standings`: a tabela de standings é cache
 *   escrito pelo trigger trg_result_changed, então antes do primeiro resultado
 *   ela está vazia mesmo com equipes cadastradas. Com LEFT JOIN, toda equipe
 *   inscrita aparece desde já.
 * - COALESCE em total_score/workouts_completed: sem linha no cache, 0 é a
 *   resposta honesta. `place` NÃO recebe COALESCE de propósito — null ali
 *   significa "ainda não pontuou", e 0 fingiria uma colocação que não existe.
 * - A ordenação empurra place null para o fim de cada categoria e desempata
 *   por nome, para a lista não dançar entre dois carregamentos.
 *
 * NÃO há desvio por modelo de pontuação (migrations 011 e 012), de propósito:
 * `place` já chega calculado com a regra certa nos dois casos — um ordena por
 * soma de colocações crescente, o outro por pontos decrescente, e os dois
 * gravam na mesma coluna. O que muda é o que a linha CARREGA: total_score
 * continua significando soma de colocações e total_points vem ao lado, nunca
 * no mesmo campo. Campo com dois significados dependendo do contexto é bug
 * esperando quem for ler depois.
 *
 * @param {number|string} championshipId
 * @param {number|string|null} categoryId  null traz todas as categorias.
 */
const fetchStandings = (championshipId, categoryId = null) =>
  queryAll(
    `SELECT t.id AS team_id, t.name AS team_name,
            c.id AS category_id, c.name AS category_name, c.gender, c.level,
            ch.scoring_model,
            COALESCE(ts.total_score, 0) AS total_score,
            -- Null no modelo legacy porque ali pontos não existem: 0 sugeriria
            -- "fez zero pontos" onde a resposta certa é "essa conta não se
            -- aplica". No points_table, 0 é honesto e vira 0.
            CASE WHEN ch.scoring_model = 'points_table'
                 THEN COALESCE(ts.total_points, 0) END AS total_points,
            COALESCE(ts.is_cut, FALSE) AS is_cut,
            ts."place",
            COALESCE(ts.workouts_completed, 0) AS workouts_completed,
            ts.updated_at
     FROM teams t
     JOIN categories c ON c.id = t.category_id
     JOIN championships ch ON ch.id = t.championship_id
     LEFT JOIN team_standings ts ON ts.team_id = t.id AND ts.championship_id = t.championship_id
     WHERE t.championship_id = $1
       AND ($2::int IS NULL OR t.category_id = $2::int)
     ORDER BY c.id ASC, (ts."place" IS NULL) ASC, ts."place" ASC, t.name ASC`,
    [championshipId, categoryId || null]
  );

module.exports = { fetchStandings };
