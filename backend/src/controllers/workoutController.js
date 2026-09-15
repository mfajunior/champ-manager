const { query, queryOne, queryAll } = require('../config/database');

/**
 * Uma prova (workout) pertence ao campeonato, não à categoria.
 * O que muda por categoria — cargas, movimentos escalados, time cap — vive em
 * workout_variants. Assim "Prova 1" é uma só no cronograma do evento, e cada
 * categoria enxerga a sua versão.
 */

// POST /api/workouts  (protegido)
// body: { championship_id, workout_number, name, type }
exports.create = async (req, res, next) => {
  try {
    const { championship_id, workout_number, name, type } = req.body;

    if (!championship_id || !workout_number || !name) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'championship_id, workout_number e name são obrigatórios',
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

    const duplicate = await queryOne(
      'SELECT id FROM workouts WHERE championship_id = $1 AND workout_number = $2',
      [championship_id, workout_number]
    );

    if (duplicate) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: `Já existe a prova número ${workout_number} neste campeonato`,
        },
      });
    }

    const workout = await queryOne(
      `INSERT INTO workouts (championship_id, workout_number, name, type, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, championship_id, workout_number, name, type, status, created_at`,
      [championship_id, workout_number, name, type || null, req.user.id]
    );

    res.status(201).json({
      data: workout,
      meta: { message: 'Prova criada com sucesso' },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/workouts?championship_id=1  (público)
exports.getAll = async (req, res, next) => {
  try {
    const { championship_id } = req.query;

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

    const workouts = await queryAll(
      `SELECT w.id, w.championship_id, w.workout_number, w.name, w.type, w.status, w.created_at,
              COUNT(wv.id)::int AS variants_count
       FROM workouts w
       LEFT JOIN workout_variants wv ON wv.workout_id = w.id
       WHERE w.championship_id = $1
       GROUP BY w.id
       ORDER BY w.workout_number ASC`,
      [championship_id]
    );

    res.status(200).json({
      data: workouts,
      meta: { message: 'Provas recuperadas com sucesso' },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/workouts/:id  (público)
// Traz a prova com a variante de cada categoria — é o que a tela do organizador precisa.
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const workout = await queryOne(
      `SELECT id, championship_id, workout_number, name, type, status, description, created_at
       FROM workouts WHERE id = $1`,
      [id]
    );

    if (!workout) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Prova não encontrada' },
      });
    }

    const variants = await queryAll(
      `SELECT wv.id, wv.category_id, c.name AS category_name, c.gender, c.level,
              wv.description, wv.time_cap_seconds, wv.updated_at
       FROM workout_variants wv
       JOIN categories c ON c.id = wv.category_id
       WHERE wv.workout_id = $1
       ORDER BY c.id ASC`,
      [id]
    );

    res.status(200).json({
      data: { ...workout, variants },
      meta: {
        message: 'Prova recuperada com sucesso',
        variantsCount: variants.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/workouts/:id  (protegido)
// body: { workout_number?, name?, type?, status?, description? }
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { workout_number, name, type, status, description } = req.body;

    const workout = await queryOne(
      'SELECT id, championship_id FROM workouts WHERE id = $1',
      [id]
    );

    if (!workout) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Prova não encontrada' },
      });
    }

    if (workout_number !== undefined) {
      const duplicate = await queryOne(
        `SELECT id FROM workouts
         WHERE championship_id = $1 AND workout_number = $2 AND id <> $3`,
        [workout.championship_id, workout_number, id]
      );

      if (duplicate) {
        return res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: `Já existe a prova número ${workout_number} neste campeonato`,
          },
        });
      }
    }

    // COALESCE deixa o cliente mandar só o que mudou, em vez de reenviar o objeto inteiro.
    const updated = await queryOne(
      `UPDATE workouts
       SET workout_number = COALESCE($1, workout_number),
           name           = COALESCE($2, name),
           type           = COALESCE($3, type),
           status         = COALESCE($4, status),
           description    = COALESCE($5, description),
           updated_at     = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING id, championship_id, workout_number, name, type, status, description, updated_at`,
      [
        workout_number ?? null,
        name ?? null,
        type ?? null,
        status ?? null,
        description ?? null,
        id,
      ]
    );

    res.status(200).json({
      data: updated,
      meta: { message: 'Prova atualizada com sucesso' },
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/workouts/:id  (protegido)
// CASCADE remove workout_variants, heats, heat_teams e results desta prova.
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;

    const workout = await queryOne('SELECT id FROM workouts WHERE id = $1', [id]);

    if (!workout) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Prova não encontrada' },
      });
    }

    await query('DELETE FROM workouts WHERE id = $1', [id]);

    res.status(200).json({
      data: null,
      meta: { message: 'Prova deletada com sucesso' },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================================
// VARIANTES — a descrição da prova para uma categoria específica
// ============================================================================

// PUT /api/workouts/:workout_id/variants/:category_id  (protegido)
// body: { description, time_cap_seconds? }
//
// É PUT e não POST porque a operação é idempotente: existe no máximo uma
// variante por (prova, categoria). Chamar duas vezes com o mesmo corpo deixa o
// banco no mesmo estado — o ON CONFLICT cuida disso.
exports.upsertVariant = async (req, res, next) => {
  try {
    const { workout_id, category_id } = req.params;
    const { description, time_cap_seconds } = req.body;

    if (!description) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'description é obrigatória' },
      });
    }

    const workout = await queryOne(
      'SELECT id, championship_id FROM workouts WHERE id = $1',
      [workout_id]
    );

    if (!workout) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Prova não encontrada' },
      });
    }

    const category = await queryOne(
      'SELECT id, championship_id FROM categories WHERE id = $1',
      [category_id]
    );

    if (!category) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Categoria não encontrada' },
      });
    }

    // Sem esta checagem, daria para pendurar a variante de um campeonato na prova
    // de outro — as duas FKs são válidas isoladamente, mas a combinação não é.
    if (category.championship_id !== workout.championship_id) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A categoria não pertence ao mesmo campeonato da prova',
        },
      });
    }

    const variant = await queryOne(
      `INSERT INTO workout_variants (workout_id, category_id, description, time_cap_seconds)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workout_id, category_id)
       DO UPDATE SET description = EXCLUDED.description,
                     time_cap_seconds = EXCLUDED.time_cap_seconds,
                     updated_at = CURRENT_TIMESTAMP
       RETURNING id, workout_id, category_id, description, time_cap_seconds, updated_at`,
      [workout_id, category_id, description, time_cap_seconds || null]
    );

    res.status(200).json({
      data: variant,
      meta: { message: 'Variante salva com sucesso' },
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/workouts/:workout_id/variants/:category_id  (protegido)
exports.deleteVariant = async (req, res, next) => {
  try {
    const { workout_id, category_id } = req.params;

    const variant = await queryOne(
      'SELECT id FROM workout_variants WHERE workout_id = $1 AND category_id = $2',
      [workout_id, category_id]
    );

    if (!variant) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Variante não encontrada' },
      });
    }

    await query('DELETE FROM workout_variants WHERE id = $1', [variant.id]);

    res.status(200).json({
      data: null,
      meta: { message: 'Variante deletada com sucesso' },
    });
  } catch (error) {
    next(error);
  }
};
