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
 * Limitação conhecida: recalculate_standings só roda quando um resultado é
 * inserido/atualizado/apagado. Um campeonato com times cadastrados mas ainda
 * sem nenhum resultado lançado não tem linha nenhuma em team_standings —
 * o leaderboard volta vazio até a primeira prova ser pontuada, mesmo que os
 * times já existam. Não é bug deste endpoint; é a tabela cache ainda não ter
 * sido populada uma primeira vez.
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
    const standings = await queryAll(
      `SELECT ts.id, ts.team_id, t.name AS team_name,
              ts.category_id, c.name AS category_name, c.gender, c.level,
              ts.total_score, ts."place", ts.workouts_completed, ts.updated_at
       FROM team_standings ts
       JOIN teams t ON t.id = ts.team_id
       JOIN categories c ON c.id = ts.category_id
       WHERE ts.championship_id = $1
         AND ($2::int IS NULL OR ts.category_id = $2::int)
       ORDER BY c.id ASC, ts."place" ASC`,
      [championship_id, category_id || null]
    );

    res.status(200).json({
      data: standings,
      meta: {
        message:
          standings.length > 0
            ? 'Leaderboard recuperado com sucesso'
            : 'Nenhum resultado lançado ainda neste campeonato — leaderboard vazio até a primeira prova ser pontuada',
        total: standings.length,
      },
    });
  } catch (error) {
    next(error);
  }
};
