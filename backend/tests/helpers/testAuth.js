const bcryptjs = require('bcryptjs');
const { query } = require('../../src/config/database');
const { generateToken } = require('../../src/middleware/auth');

/**
 * Os testes de integração precisam de um usuário autenticado pra chamar as
 * rotas protegidas, mas não existe mais POST /api/auth/register pra criar um
 * (o autocadastro foi desativado — só quem já tem conta consegue logar,
 * decisão registrada em ARCHITECTURE.md). Este helper faz o equivalente
 * direto no banco: mesmo hash de senha que authController.login espera
 * comparar, e token assinado com o mesmo generateToken que authMiddleware
 * valida — pro teste, o resultado é indistinguível de um usuário que logou
 * de verdade.
 */
async function createTestUser({ email, password = 'jest12345', name = 'Jest User' } = {}) {
  const passwordHash = await bcryptjs.hash(password, 10);
  const result = await query(
    `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name`,
    [email, passwordHash, name]
  );
  const user = result.rows[0];
  const token = generateToken(user);
  return { user, token };
}

module.exports = { createTestUser };
