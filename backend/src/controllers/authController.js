const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, queryOne } = require('../config/database');

/**
 * Registra novo operador (usuário)
 * POST /api/auth/register
 */
exports.register = async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    // Validação básica
    if (!email || !password || !name) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email, password e name são obrigatórios'
        }
      });
    }

    // Verificar se usuário já existe
    const existingUser = await queryOne(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser) {
      return res.status(400).json({
        error: {
          code: 'USER_EXISTS',
          message: 'Email já registrado'
        }
      });
    }

    // Hash da senha
    const hashedPassword = await bcryptjs.hash(password, 10);

    // Inserir usuário
    const result = await query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name`,
      [email, hashedPassword, name]
    );

    const user = result.rows[0];

    // Gerar JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      data: {
        user,
        token
      },
      meta: {
        message: 'Usuário registrado com sucesso'
      }
    });

  } catch (err) {
    next(err);
  }
};

/**
 * Login de operador
 * POST /api/auth/login
 */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validação
    if (!email || !password) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email e password são obrigatórios'
        }
      });
    }

    // Buscar usuário
    const user = await queryOne(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [email]
    );

    if (!user) {
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Email ou senha incorretos'
        }
      });
    }

    // Comparar senha
    const passwordMatch = await bcryptjs.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Email ou senha incorretos'
        }
      });
    }

    // Gerar JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name
        },
        token
      },
      meta: {
        message: 'Login realizado com sucesso'
      }
    });

  } catch (err) {
    next(err);
  }
};