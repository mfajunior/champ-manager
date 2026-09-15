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
    const { name, date, location } = req.body;

    if (!name || !date || !location) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Nome, data e local são obrigatórios',
        },
      });
    }

    const championship = await queryOne(
      `INSERT INTO championships (name, date, location, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, date, location, is_active, created_at`,
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
exports.getAll = async (req, res, next) => {
  try {
    const championships = await queryAll(
      `SELECT c.id, c.name, c.date, c.location, c.is_active, c.created_at,
              COUNT(DISTINCT t.id)::int AS teams_count,
              COUNT(DISTINCT w.id)::int AS workouts_count
       FROM championships c
       LEFT JOIN teams t ON t.championship_id = c.id
       LEFT JOIN workouts w ON w.championship_id = c.id
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
      `SELECT id, name, date, location, is_active, created_at
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
    const { name, date, location, is_active } = req.body;

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
       SET name       = COALESCE($1, name),
           date       = COALESCE($2, date),
           location   = COALESCE($3, location),
           is_active  = COALESCE($4, is_active),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING id, name, date, location, is_active, updated_at`,
      [name ?? null, date ?? null, location ?? null, is_active ?? null, id]
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
