const request = require('supertest');
const app = require('../../src/app');
const { pool } = require('../../src/config/database');

/**
 * authController é o único ponto de entrada de todo o sistema: se o registro
 * ou o login tiverem um bug, nenhuma outra rota protegida é alcançável. O
 * teste mais importante aqui não é o caminho feliz — é a mensagem genérica
 * "Email ou senha incorretos" para os dois casos de falha (email inexistente
 * e senha errada), porque é isso que impede um atacante de descobrir quais
 * emails estão cadastrados só testando o login.
 */
describe('Autenticação (integração com banco real)', () => {
  const email = `jest-auth-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
  const password = 'jest12345';

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
    await pool.end();
  });

  test('POST /register com dados válidos cria usuário e devolve token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password, name: 'Jest Auth' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user).not.toHaveProperty('password_hash');
    expect(typeof res.body.data.token).toBe('string');
  });

  test('POST /register rejeita corpo malformado antes de tocar no banco (400)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'nao-e-um-email', password: '123', name: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('POST /register com email já cadastrado devolve 409, não 400', async () => {
    // 409: o corpo da requisição está bem formado, o conflito é o estado atual
    // do servidor (mesmo motivo documentado no próprio authController).
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password, name: 'Jest Auth Duplicado' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USER_EXISTS');
  });

  test('POST /login com credenciais corretas devolve token', async () => {
    const res = await request(app).post('/api/auth/login').send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(email);
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
    const semailInexistente = `nao-existe-${Date.now()}@champy.local`;
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: semailInexistente, password: 'qualquer-coisa' });

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
