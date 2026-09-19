const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * O create de campeonato é o único endpoint que gera dados derivados sem o
 * cliente pedir explicitamente: as 5 categorias fixas (Iniciante M/F, Scale
 * M/F, RX Misto) nascem junto, num só INSERT com múltiplos VALUES. É esse
 * comportamento — não o CRUD básico em si — que vale a pena testar contra
 * banco de verdade.
 */
describe('Championships (integração com banco real)', () => {
  let token;
  let championshipId;

  beforeAll(async () => {
    const email = `jest-champ-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest Championships' })).token;
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('POST / sem token é rejeitado (401) antes de qualquer validação', async () => {
    const res = await request(app)
      .post('/api/championships')
      .send({ name: 'Sem Token', date: '2026-12-01', location: 'Box X' });

    expect(res.status).toBe(401);
  });

  test('POST / com campo obrigatório faltando é rejeitado pelo Joi (400)', async () => {
    const res = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Sem Data', location: 'Box X' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('POST / cria o campeonato com as 5 categorias fixas', async () => {
    const res = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest Open 2026', date: '2026-11-01', location: 'Box Jest' });

    expect(res.status).toBe(201);
    championshipId = res.body.data.id;

    const nomes = res.body.data.categories.map((c) => c.name).sort();
    expect(nomes).toEqual(
      [
        'Iniciante Feminino',
        'Iniciante Masculino',
        'RX Misto',
        'Scale Feminino',
        'Scale Masculino',
      ].sort()
    );

    const rx = res.body.data.categories.find((c) => c.name === 'RX Misto');
    expect(rx.gender).toBe('misto');
    expect(rx.level).toBe('rx');
  });

  test('GET /:id devolve o campeonato com contagem de equipes por categoria', async () => {
    const res = await request(app).get(`/api/championships/${championshipId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.categories).toHaveLength(5);
    // Recém-criado: nenhuma equipe ainda em nenhuma categoria.
    expect(res.body.data.categories.every((c) => c.teams_count === 0)).toBe(true);
  });

  test('GET /:id inexistente devolve 404', async () => {
    const res = await request(app).get('/api/championships/999999999');
    expect(res.status).toBe(404);
  });

  test('GET / (lista) inclui o campeonato recém-criado', async () => {
    const res = await request(app).get('/api/championships');

    expect(res.status).toBe(200);
    const ids = res.body.data.map((c) => c.id);
    expect(ids).toContain(championshipId);
  });

  test('PUT /:id atualiza só o campo enviado, preserva o resto', async () => {
    const res = await request(app)
      .put(`/api/championships/${championshipId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ location: 'Box Jest — Novo Endereço' });

    expect(res.status).toBe(200);
    expect(res.body.data.location).toBe('Box Jest — Novo Endereço');
    expect(res.body.data.name).toBe('Jest Open 2026'); // não mudou
  });

  test('PUT /:id com corpo vazio é rejeitado pelo Joi (400)', async () => {
    const res = await request(app)
      .put(`/api/championships/${championshipId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('PUT is_active:false arquiva — some da listagem padrão mas continua existindo', async () => {
    const arquivar = await request(app)
      .put(`/api/championships/${championshipId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ is_active: false });

    expect(arquivar.status).toBe(200);
    expect(arquivar.body.data.is_active).toBe(false);

    const listaPadrao = await request(app).get('/api/championships');
    expect(listaPadrao.body.data.map((c) => c.id)).not.toContain(championshipId);

    // O campeonato continua existindo — arquivar não é o mesmo que apagar.
    const detalhe = await request(app).get(`/api/championships/${championshipId}`);
    expect(detalhe.status).toBe(200);

    const listaComArquivados = await request(app).get('/api/championships?include_archived=true');
    expect(listaComArquivados.body.data.map((c) => c.id)).toContain(championshipId);

    // Desarquiva de novo pra não interferir no teste de DELETE logo abaixo.
    await request(app)
      .put(`/api/championships/${championshipId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ is_active: true });
  });

  test('DELETE /:id apaga o campeonato e arrasta as categorias por CASCADE', async () => {
    const del = await request(app)
      .delete(`/api/championships/${championshipId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(del.status).toBe(200);

    const categoriasRestantes = await pool.query(
      'SELECT id FROM categories WHERE championship_id = $1',
      [championshipId]
    );
    expect(categoriasRestantes.rows).toHaveLength(0);

    const getDepois = await request(app).get(`/api/championships/${championshipId}`);
    expect(getDepois.status).toBe(404);

    championshipId = null; // já apagado — não precisa limpar de novo no afterAll
  });
});
