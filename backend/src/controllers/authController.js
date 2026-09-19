const bcryptjs = require('bcryptjs');
const { queryOne } = require('../config/database');
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
 * Login de operador
 * POST /api/auth/login
 *
 * Não existe mais POST /api/auth/register: contas são criadas direto no
 * banco (ver README/DEVELOPMENT.md), não por autocadastro público.
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
