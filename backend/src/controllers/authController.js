const bcryptjs = require('bcryptjs');
const { query, queryOne } = require('../config/database');
const { generateToken } = require('../middleware/auth');

/**
 * O token é gerado pelo helper do middleware, não por um jwt.sign local.
 *
 * Duplicar a assinatura aqui foi o que causou o bug: este arquivo assinava
 * { userId, email } enquanto o middleware lia decoded.id, então req.user.id
 * chegava undefined em toda rota protegida e created_by/registered_by gravavam
 * NULL silenciosamente. Quem escreve o payload e quem lê o payload agora são o
 * mesmo módulo, e as duas pontas não podem mais divergir.
 */

/**
 * Registra novo operador (usuário)
 * POST /api/auth/register
 */
exports.register = async (req, res, next) => {
  try {
    // Formato do corpo (email válido, senha com tamanho mínimo, name presente)
    // já foi validado pelo middleware `validate(schemas.authRegister)` na rota.
    const { email, password, name } = req.body;

    const existingUser = await queryOne('SELECT id FROM users WHERE email = $1', [
      email,
    ]);

    if (existingUser) {
      // 409 e não 400: a requisição está bem formada, o conflito é com o estado
      // atual do servidor. O cliente sabe que precisa tentar outro email, não
      // corrigir o corpo da requisição.
      return res.status(409).json({
        error: {
          code: 'USER_EXISTS',
          message: 'Email já registrado',
        },
      });
    }

    const hashedPassword = await bcryptjs.hash(password, 10);

    const result = await query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name`,
      [email, hashedPassword, name]
    );

    const user = result.rows[0];

    res.status(201).json({
      data: {
        user,
        token: generateToken(user),
      },
      meta: {
        message: 'Usuário registrado com sucesso',
      },
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
    // Formato do corpo já validado pelo middleware `validate(schemas.authLogin)`.
    const { email, password } = req.body;

    const user = await queryOne(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [email]
    );

    // Mesma mensagem para email inexistente e senha errada: dizer qual dos dois
    // falhou entrega a um atacante a lista de emails cadastrados.
    if (!user) {
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Email ou senha incorretos',
        },
      });
    }

    const passwordMatch = await bcryptjs.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Email ou senha incorretos',
        },
      });
    }

    const safeUser = { id: user.id, email: user.email, name: user.name };

    res.json({
      data: {
        user: safeUser,
        token: generateToken(safeUser),
      },
      meta: {
        message: 'Login realizado com sucesso',
      },
    });
  } catch (err) {
    next(err);
  }
};
