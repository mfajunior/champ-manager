const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * O autocadastro público (POST /api/auth/register) foi removido: o app tem
 * um único operador (o organizador do campeonato), não múltiplos usuários se
 * registrando sozinhos — e antes disso, qualquer pessoa que descobrisse a
 * rota conseguia criar uma conta com acesso total (não existe distinção de
 * papel/role entre usuários). Ver decisão em ARCHITECTURE.md.
 *
 * Sem endpoint de registro, o usuário de teste é criado direto no banco via
 * createTestUser (helpers/testAuth.js) — o equivalente ao que o registro
 * fazia, sem depender de uma rota HTTP que não existe mais.
 *
 * authController.login continua sendo o único ponto de entrada de todo o
 * sistema: se ele tiver um bug, nenhuma rota protegida é alcançável. O teste
 * mais importante aqui não é o caminho feliz — é a mensagem genérica "Email
 * ou senha incorretos" para os dois casos de falha (email inexistente e
 * senha errada), porque é isso que impede um atacante de descobrir quais
 * emails estão cadastrados só testando o login.
 */
describe('Autenticação (integração com banco real)', () => {
  const email = `jest-auth-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
  const password = 'jest12345';

  beforeAll(async () => {
    await createTestUser({ email, password, name: 'Jest Auth' });
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
    await pool.end();
  });

  test('POST /api/auth/register não existe mais (404)', async () => {
    // Trava de regressão: se alguém reintroduzir essa rota sem querer (ex.:
    // copiando um router antigo), este teste quebra e avisa.
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'novo@champy.local', password: 'jest12345', name: 'Novo' });

    expect(res.status).toBe(404);
  });

  test('POST /login com credenciais corretas devolve token', async () => {
    const res = await request(app).post('/api/auth/login').send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user).not.toHaveProperty('password_hash');
    expect(typeof res.body.data.token).toBe('string');
  });

  test('POST /login com senha errada devolve 401 com mensagem genérica', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'senha-errada' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('POST /login com email inexistente devolve a MESMA mensagem genérica (401)', async () => {
    // Mesmo código e mesma mensagem do teste anterior — é exatamente o ponto:
    // não dar dica se o problema foi o email ou a senha.
    const emailInexistente = `nao-existe-${Date.now()}@champy.local`;
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: emailInexistente, password: 'qualquer-coisa' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('rota protegida sem token devolve 401', async () => {
    const res = await request(app)
      .post('/api/championships')
      .send({ name: 'X', date: '2026-12-01', location: 'Y' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NO_TOKEN');
  });
});
