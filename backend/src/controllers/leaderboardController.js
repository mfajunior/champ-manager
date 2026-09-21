const { queryOne } = require('../config/database');
const { fetchStandings } = require('../models/standings');

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
 * A consulta em si (e o porquê de cada escolha dela) está em
 * models/standings.js, compartilhada com o broadcast do WebSocket. O que
 * sobra aqui é o que é específico do endpoint HTTP: validar championship_id
 * e category_id contra o banco e devolver no envelope { data, meta }.
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

    // A consulta em si mora em models/standings.js — o broadcast do
    // WebSocket (resultController) devolve exatamente o mesmo formato, e
    // manter as duas pontas na mesma função é o que garante isso.
    // categoryId nulo traz todas as categorias.
    const standings = await fetchStandings(championship_id, category_id);

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
