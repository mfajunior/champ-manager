exports.create = async (req, res, next) => {
  // Recebe: { championship_id, name, description, date }
  // Valida se championship_id existe
  // Insere na tabela workouts
  // Retorna o workout criado
  try {
    const { championship_id, name, description, date } = req.body;
    if (!championship_id || !name || !description || !date) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Todos os campos são obrigatórios',
        },
      });
    }
    const championship = await queryOne(
      'SELECT id FROM championships WHERE id = $1',
      [championship_id]
    );

    if (!championship) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Campeonato não encontrado',
        },
      });
    }
    const result = await query(
      'INSERT INTO workouts (championship_id, name, description, date) VALUES ($1, $2, $3, $4) RETURNING id, championship_id, name, description, date, created_at',
      [championship_id, name, description, date]
    );
    const workout = result.rows[0];
    res.status(201).json({
      data: workout,
      meta: {
        message: 'WOD criado com sucesso',
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.getByChampionship = async (req, res, next) => {
  // Recebe o championship_id via params
  // Retorna todos os workouts desse campeonato
  try {
    const { championship_id } = req.params;
    const championship = await queryOne(
      'SELECT id FROM championships WHERE id = $1',
      [championship_id]
    );

    if (!championship) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Campeonato não encontrado',
        },
      });
    }

    const wodsResult = await query(
      'SELECT id, championship_id, name, description, date FROM workouts WHERE championship_id = $1 ORDER BY date ASC',
      [championship_id]
    );
    res.status(200).json({
      data: wodsResult.rows,
      meta: {
        message: 'WODs recuperados com sucesso',
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.getById = async (req, res, next) => {
  // Retorna um workout específico
    try {
    const { id } = req.params;
    const workout = await queryOne(
      'SELECT id, championship_id, name, description, date, created_at FROM workouts WHERE id = $1',
      [id]
    );

    if (!workout) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'WOD não encontrado',
        },
      });
    }

    res.status(200).json({
      data: workout,
      meta: {
        message: 'WOD recuperado com sucesso',
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.update = async (req, res, next) => {
  // Recebe: { name, description, date }
  // Atualiza o workout
  try {
    const { id } = req.params;
    const { name, description, date } = req.body;
    if (!name || !description || !date) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Todos os campos são obrigatórios',
        },
      });
    }

    const workout = await queryOne(
    'SELECT id FROM workouts WHERE id = $1',
    [id]
);

if (!workout) {
  return res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'WOD não encontrado',
    },
  });
}
    const result = await query(
      'UPDATE workouts SET name = $1, description = $2, date = $3 WHERE id = $4 RETURNING id, championship_id, name, description, date, created_at',
      [name, description, date, id]
    );
    res.status(200).json({
      data: result.rows[0],
      meta: {
        message: 'WOD atualizado com sucesso',
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.delete = async (req, res, next) => {
  // Deleta o workout (cascade delete em heat_teams e heats)
  try {
    const { id } = req.params;
    const workout = await queryOne(
      'SELECT id FROM workouts WHERE id = $1',
      [id]
    );

    if (!workout) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'WOD não encontrado',
        },
      });
    }

    await query(
      'DELETE FROM workouts WHERE id = $1',
      [id]
    );
    res.status(200).json({
      data: null,
      meta: {
        message: 'WOD deletado com sucesso',
      },
    });
  } catch (error) {
    next(error);
  }
};
