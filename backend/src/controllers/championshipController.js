const { query, queryOne } = require('../config/database');

exports.create = async (req, res, next) => {
  try {
    const { name, date, location } = req.body;

    if (!name || !date || !location) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Nome, data e local são obrigatórios'
        }
      });
    }

    const result = await query(
      'INSERT INTO championships (name, date, location) VALUES ($1, $2, $3) RETURNING id, name, date, location, created_at',
      [name, date, location]
    );

    const championship = result.rows[0];

    // Criar categorias padrão
    const categories = ['Iniciante Masculino', 'Iniciante Feminino', 'Scale Masculino', 'Scale Feminino', 'RX Misto'];
    for (const categoryName of categories) {
      await query(
        'INSERT INTO categories (championship_id, name) VALUES ($1, $2)',
        [championship.id, categoryName]
      );
    }

    res.status(201).json({
      data: championship,
      meta: {
        message: 'Campeonato criado com sucesso',
        categoriesCreated: categories.length
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const championship = await queryOne(
      'SELECT id, name, date, location, created_at FROM championships WHERE id = $1',
      [id]
    );

    if (!championship) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Campeonato não encontrado'
        }
      });
    }

    const categoriesResult = await query(
      'SELECT id, name FROM categories WHERE championship_id = $1 ORDER BY id',
      [id]
    );

    res.json({
      data: {
        ...championship,
        categories: categoriesResult.rows
      },
      meta: {
        message: 'Campeonato recuperado com sucesso'
      }
    });
  } catch (err) {
    next(err);
  }
};
