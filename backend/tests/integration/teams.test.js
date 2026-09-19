const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * A regra que mais importa aqui não é o CRUD em si, é a migration 002: uma
 * equipe é única dentro da CATEGORIA, não do campeonato inteiro. "Equipe
 * Alpha" precisa poder existir em Iniciante Masculino e em RX Misto ao mesmo
 * tempo, no mesmo campeonato — e isso só se comprova com um INSERT de verdade
 * no banco, uma constraint SQL não dá pra simular com mock.
 */
describe('Teams (integração com banco real)', () => {
  let token;
  let championshipId;
  let outroChampionshipId;
  let categoriaA;
  let categoriaB;
  let categoriaDeOutroChampionship;

  beforeAll(async () => {
    const email = `jest-teams-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest Teams' })).token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest Teams Championship', date: '2026-11-05', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;
    categoriaA = campeonato.body.data.categories.find((c) => c.name === 'Iniciante Masculino').id;
    categoriaB = campeonato.body.data.categories.find((c) => c.name === 'RX Misto').id;

    const outro = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest Outro Championship', date: '2026-11-06', location: 'Box Jest 2' });
    outroChampionshipId = outro.body.data.id;
    categoriaDeOutroChampionship = outro.body.data.categories[0].id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM championships WHERE id = ANY($1::int[])', [
      [championshipId, outroChampionshipId].filter(Boolean),
    ]);
    await pool.end();
  });

  test('POST / cria a equipe na categoria informada', async () => {
    const res = await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ championship_id: championshipId, category_id: categoriaA, name: 'Equipe Alpha' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Equipe Alpha');
    expect(res.body.data.category_id).toBe(categoriaA);
  });

  test('mesmo nome em OUTRA categoria do mesmo campeonato é permitido (migration 002)', async () => {
    const res = await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ championship_id: championshipId, category_id: categoriaB, name: 'Equipe Alpha' });

    expect(res.status).toBe(201);
    expect(res.body.data.category_id).toBe(categoriaB);
  });

  test('mesmo nome NA MESMA categoria é rejeitado (409)', async () => {
    const res = await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ championship_id: championshipId, category_id: categoriaA, name: 'Equipe Alpha' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  test('categoria que não pertence ao championship_id informado é rejeitada (400)', async () => {
    const res = await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({
        championship_id: championshipId,
        category_id: categoriaDeOutroChampionship,
        name: 'Equipe Impostora',
      });

    expect(res.status).toBe(400);
  });

  test('POST / com campo faltando é rejeitado pelo Joi antes do banco (400)', async () => {
    const res = await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ championship_id: championshipId, name: 'Sem Categoria' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('GET / sem championship_id é rejeitado (400)', async () => {
    const res = await request(app).get('/api/teams');
    expect(res.status).toBe(400);
  });

  test('GET /?championship_id filtra por category_id opcionalmente', async () => {
    const todas = await request(app).get(`/api/teams?championship_id=${championshipId}`);
    expect(todas.status).toBe(200);
    expect(todas.body.data).toHaveLength(2); // Alpha em categoriaA + Alpha em categoriaB

    const soCategoriaA = await request(app).get(
      `/api/teams?championship_id=${championshipId}&category_id=${categoriaA}`
    );
    expect(soCategoriaA.body.data).toHaveLength(1);
    expect(soCategoriaA.body.data[0].category_id).toBe(categoriaA);
  });

  test('PUT /:id renomeia a equipe', async () => {
    const lista = await request(app).get(
      `/api/teams?championship_id=${championshipId}&category_id=${categoriaA}`
    );
    const teamId = lista.body.data[0].id;

    const res = await request(app)
      .put(`/api/teams/${teamId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Equipe Alpha Renomeada' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Equipe Alpha Renomeada');
  });

  test('DELETE /:id remove a equipe', async () => {
    const lista = await request(app).get(
      `/api/teams?championship_id=${championshipId}&category_id=${categoriaA}`
    );
    const teamId = lista.body.data[0].id;

    const del = await request(app)
      .delete(`/api/teams/${teamId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const getDepois = await request(app).get(`/api/teams/${teamId}`);
    expect(getDepois.status).toBe(404);
  });
});
