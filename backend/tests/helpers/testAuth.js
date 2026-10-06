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
// Custo 4 em vez dos 10 de produção. O custo fica gravado dentro do próprio
// hash, e bcryptjs.compare lê de lá — ou seja, o login de verdade
// (authController.login) continua validando este hash sem saber a diferença.
// Medido nesta máquina: 78ms com 10, 1ms com 4, uma vez por arquivo de teste.
// Reduzir custo de hash só é aceitável porque isto nunca sai de tests/.
const CUSTO_BCRYPT_EM_TESTE = 4;

async function createTestUser({ email, password = 'jest12345', name = 'Jest User' } = {}) {
  const passwordHash = await bcryptjs.hash(password, CUSTO_BCRYPT_EM_TESTE);
  const result = await query(
    `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name`,
    [email, passwordHash, name]
  );
  const user = result.rows[0];
  const token = generateToken(user);
  return { user, token };
}

module.exports = { createTestUser };
