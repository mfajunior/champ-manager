const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');
const { _ligarParaTeste } = require('../../src/middleware/cacheLeitura');

/**
 * O cache de leitura fica DESLIGADO em teste por padrão: ele é estado dentro do
 * processo, e a suíte roda o app em processo — ligado, uma suíte envenenaria a
 * outra (um campeonato criado aqui apareceria na listagem cacheada de lá).
 *
 * Esta suíte é a única que o liga, e desliga no fim. É também a única cobertura
 * que o cache tem: com ele desligado nas outras 21 suítes, elas passam com ou
 * sem bug aqui.
 */
describe('Cache de leitura (integração com banco real)', () => {
  let token;
  let championshipId;
  let categoryId;

  beforeAll(async () => {
    const email = `jest-cache-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest Cache' })).token;

    const criado = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest Cache Championship', date: '2026-12-20', location: 'Box Jest' });

    championshipId = criado.body.data.id;
    categoryId = criado.body.data.categories.find((c) => c.name === 'RX Misto').id;

    _ligarParaTeste(true);
  });

  afterAll(async () => {
    _ligarParaTeste(false);
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('a segunda leitura idêntica vem do cache, com o mesmo corpo', async () => {
    const rota = `/api/leaderboard?championship_id=${championshipId}`;

    const primeira = await request(app).get(rota);
    expect(primeira.status).toBe(200);
    expect(primeira.headers['x-cache']).toBe('MISS');

    const segunda = await request(app).get(rota);
    expect(segunda.status).toBe(200);
    expect(segunda.headers['x-cache']).toBe('HIT');

    // O corpo servido do cache tem que ser indistinguível do original — é o
    // ponto inteiro: o espectador não pode notar diferença.
    expect(segunda.body).toEqual(primeira.body);
  });

  test('uma escrita bem-sucedida invalida o cache', async () => {
    const rota = `/api/leaderboard?championship_id=${championshipId}`;

    await request(app).get(rota);
    const cacheada = await request(app).get(rota);
    expect(cacheada.headers['x-cache']).toBe('HIT');

    // Equipe nova = o placar mudou. A invalidação está no middleware global do
    // /api, não neste controller — então esta escrita, que não sabe nada sobre
    // cache, precisa derrubá-lo mesmo assim.
    const nova = await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ championship_id: championshipId, category_id: categoryId, name: 'Equipe do Cache' });
    expect(nova.status).toBe(201);

    const depois = await request(app).get(rota);
    expect(depois.headers['x-cache']).toBe('MISS');
    expect(depois.body.data.some((linha) => linha.team_name === 'Equipe do Cache')).toBe(true);
  });

  test('resposta de erro não entra no cache', async () => {
    // Sem championship_id o controller devolve 400. Cachear isso faria um erro
    // momentâneo virar erro garantido pelo resto do TTL.
    const primeira = await request(app).get('/api/leaderboard');
    expect(primeira.status).toBe(400);

    const segunda = await request(app).get('/api/leaderboard');
    expect(segunda.status).toBe(400);
    expect(segunda.headers['x-cache']).toBe('MISS');
  });
});
