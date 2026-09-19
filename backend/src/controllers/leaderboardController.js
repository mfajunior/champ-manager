const { queryOne, queryAll } = require('../config/database');

/**
 * O leaderboard é só leitura: team_standings é uma tabela cache mantida pelo
 * trigger trg_result_changed (migration 003) toda vez que um resultado é
 * criado, corrigido ou apagado. Este controller nunca escreve nela.
 *
 * Ranking por CATEGORIA, não pelo campeonato inteiro (migration 002) — times
 * de "Iniciante Feminino" e "RX Misto" não competem entre si, então não faz
 * sentido compará-los na mesma tabela de colocação. total_score é a soma das
 * colocações em cada prova (golfe: menor é melhor), e o "place" final usa
 * ROW_NUMBER (não RANK como em results): aqui NÃO há empate — o desempate
 * final é sempre team_id, então a lista é sempre 1, 2, 3... sem buracos nem
 * posições repetidas.
 *
 * A consulta parte de teams (LEFT JOIN team_standings), não de team_standings
 * direto: a tabela cache só é escrita pelo trigger, então antes do primeiro
 * resultado do campeonato inteiro ela não tem NENHUMA linha, mesmo com times
 * já cadastrados. Partindo de teams, toda equipe cadastrada aparece desde
 * já — com place null e total_score/workouts_completed em 0 até que exista
 * ao menos um resultado em algum lugar do campeonato (o que aciona o
 * trigger e passa a preencher o "place" de verdade, inclusive das que ainda
 * não pontuaram — essas ficam por último dentro da categoria, ver migration
 * 002). Antes disso, dá pra ver quem já está inscrito mesmo sem nada
 * pontuado ainda.
 */

// GET /api/leaderboard?championship_id=1&category_id=3  (público)
// category_id é opcional: sem ele, traz todas as categorias do campeonato.
exports.getByChampionship = async (req, res, next) => {
  try {
    const { championship_id, category_id } = req.query;

    if (!championship_id) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'championship_id é obrigatório na query string',
        },
      });
    }

    const championship = await queryOne(
      'SELECT id FROM championships WHERE id = $1',
      [championship_id]
    );

    if (!championship) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Campeonato não encontrado' },
      });
    }

    if (category_id) {
      const category = await queryOne(
        'SELECT id, championship_id FROM categories WHERE id = $1',
        [category_id]
      );

      if (!category) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Categoria não encontrada' },
        });
      }

      if (Number(category.championship_id) !== Number(championship_id)) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'A categoria não pertence a este campeonato',
          },
        });
      }
    }

    // $2 nulo desliga o filtro de categoria, igual ao padrão usado em results/heats.
    // LEFT JOIN team_standings (não JOIN): equipe sem linha ainda na tabela
    // cache continua aparecendo, só com place null e total_score/
    // workouts_completed em 0 (COALESCE) em vez de sumir da lista.
    const standings = await queryAll(
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
      [championship_id, category_id || null]
    );

    res.status(200).json({
      data: standings,
      meta: {
        message:
          standings.length > 0
            ? 'Leaderboard recuperado com sucesso'
            : 'Nenhuma equipe cadastrada ainda neste campeonato',
        total: standings.length,
      },
    });
  } catch (error) {
    next(error);
  }
};
