const { query, queryOne, queryAll } = require('../config/database');

/**
 * Categorias padrão de um campeonato.
 *
 * gender e level ficam em colunas próprias, não só embutidos no nome: a
 * geração de baterias e o leaderboard filtram por eles, e derivar isso de uma
 * string ("RX Misto" → level rx, gender misto) na hora da query seria frágil e
 * quebraria no primeiro nome fora do padrão.
 */
const DEFAULT_CATEGORIES = [
  { name: 'Iniciante Masculino', level: 'iniciante', gender: 'masculino' },
  { name: 'Iniciante Feminino', level: 'iniciante', gender: 'feminino' },
  { name: 'Scale Masculino', level: 'scale', gender: 'masculino' },
  { name: 'Scale Feminino', level: 'scale', gender: 'feminino' },
  { name: 'RX Misto', level: 'rx', gender: 'misto' },
];

// POST /api/championships  (protegido)
exports.create = async (req, res, next) => {
  try {
    // Formato do corpo já validado pelo middleware `validate(schemas.championshipCreate)`.
    const { name, date, location } = req.body;

    // Raias, transição e hora de início são parâmetros globais de agenda
    // (championships.lanes_per_heat/transition_seconds/start_time — ver
    // migration 005) configurados DEPOIS, em "configurações do campeonato"
    // (update), não na criação: nesse momento o organizador ainda pode nem
    // saber quantas raias o box tem disponíveis.
    const championship = await queryOne(
      `INSERT INTO championships (name, date, location, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, date, location, is_active, created_at,
                 lanes_per_heat, transition_seconds, start_time`,
      [name, date, location, req.user.id]
    );

    // Um INSERT com múltiplos VALUES em vez de cinco idas ao banco dentro de um loop.
    const values = DEFAULT_CATEGORIES.map(
      (_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`
    ).join(', ');

    const params = [championship.id];
    DEFAULT_CATEGORIES.forEach((c) => params.push(c.name, c.gender, c.level));

    const categories = await queryAll(
      `INSERT INTO categories (championship_id, name, gender, level)
       VALUES ${values}
       RETURNING id, name, gender, level`,
      params
    );

    res.status(201).json({
      data: { ...championship, categories },
      meta: {
        message: 'Campeonato criado com sucesso',
        categoriesCreated: categories.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/championships  (público)
// ?include_archived=true também traz os arquivados (is_active = false).
// Sem o parâmetro, um campeonato arquivado some da lista mas continua
// existindo no banco — "arquivar" é a alternativa reversível ao DELETE
// (que apaga o campeonato e tudo que depende dele por CASCADE).
exports.getAll = async (req, res, next) => {
  try {
    const includeArchived = req.query.include_archived === 'true';

    const championships = await queryAll(
      `SELECT c.id, c.name, c.date, c.location, c.is_active, c.created_at,
              c.lanes_per_heat, c.transition_seconds, c.start_time,
              COUNT(DISTINCT t.id)::int AS teams_count,
              COUNT(DISTINCT w.id)::int AS workouts_count
       FROM championships c
       LEFT JOIN teams t ON t.championship_id = c.id
       LEFT JOIN workouts w ON w.championship_id = c.id
       ${includeArchived ? '' : 'WHERE c.is_active = TRUE'}
       GROUP BY c.id
       ORDER BY c.date DESC`
    );

    res.status(200).json({
      data: championships,
      meta: { message: 'Campeonatos recuperados com sucesso' },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/championships/:id  (público)
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const championship = await queryOne(
      `SELECT id, name, date, location, is_active, created_at,
              lanes_per_heat, transition_seconds, start_time
       FROM championships WHERE id = $1`,
      [id]
    );

    if (!championship) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Campeonato não encontrado' },
      });
    }

    const categories = await queryAll(
      `SELECT c.id, c.name, c.gender, c.level,
              COUNT(t.id)::int AS teams_count
       FROM categories c
       LEFT JOIN teams t ON t.category_id = c.id
       WHERE c.championship_id = $1
       GROUP BY c.id
       ORDER BY c.id ASC`,
      [id]
    );

    res.status(200).json({
      data: { ...championship, categories },
      meta: { message: 'Campeonato recuperado com sucesso' },
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/championships/:id  (protegido)
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, date, location, is_active, lanes_per_heat, transition_seconds, start_time } = req.body;

    const championship = await queryOne(
      'SELECT id FROM championships WHERE id = $1',
      [id]
    );

    if (!championship) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Campeonato não encontrado' },
      });
    }

    const updated = await queryOne(
      `UPDATE championships
       SET name                = COALESCE($1, name),
           date                = COALESCE($2, date),
           location            = COALESCE($3, location),
           is_active           = COALESCE($4, is_active),
           lanes_per_heat      = COALESCE($5, lanes_per_heat),
           transition_seconds  = COALESCE($6, transition_seconds),
           start_time          = COALESCE($7, start_time),
           updated_at          = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING id, name, date, location, is_active, updated_at,
                 lanes_per_heat, transition_seconds, start_time`,
      [
        name ?? null,
        date ?? null,
        location ?? null,
        is_active ?? null,
        lanes_per_heat ?? null,
        transition_seconds ?? null,
        start_time ?? null,
        id,
      ]
    );

    res.status(200).json({
      data: updated,
      meta: { message: 'Campeonato atualizado com sucesso' },
    });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/championships/:id  (protegido)
// CASCADE remove categorias, equipes, provas, baterias e resultados.
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;

    const championship = await queryOne(
      'SELECT id FROM championships WHERE id = $1',
      [id]
    );

    if (!championship) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Campeonato não encontrado' },
      });
    }

    await query('DELETE FROM championships WHERE id = $1', [id]);

    res.status(200).json({
      data: null,
      meta: { message: 'Campeonato deletado com sucesso' },
    });
  } catch (err) {
    next(err);
  }
};
