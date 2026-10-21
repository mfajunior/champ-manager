const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * group_by_category: cada bateria com uma categoria só, em vez de preencher a
 * raia que sobra com a categoria seguinte (o comportamento desde a migration
 * 005).
 *
 * O cenário é escolhido para que as duas formas dêem resultados DIFERENTES, o
 * que é o único jeito de o teste provar algo: 5 equipes em cada uma de duas
 * categorias, 4 raias.
 *
 *   misturado:  10 equipes / 4 raias -> 3 baterias (4, 3, 3), e a do meio
 *               necessariamente junta as duas categorias
 *   por categoria: cada uma arredonda a própria sobra -> 2 + 2 = 4 baterias,
 *               nenhuma mista
 *
 * Arquivo próprio, com campeonato próprio, pelo mesmo motivo que
 * heats-seeding.test.js: os testes de heats.test.js acumulam estado entre si.
 */
describe('Heats — separação por categoria (integração com banco real)', () => {
  let token;
  let championshipId;
  let categoriaA;
  let categoriaB;
  let provaMisturada;
  let provaSeparada;

  const categoriasPorBateria = (heats) =>
    heats.map((h) => [...new Set(h.teams.map((t) => t.category_name))]);

  const totalDeEquipes = (heats) =>
    heats.reduce((soma, h) => soma + h.teams.length, 0);

  beforeAll(async () => {
    const email = `jest-porcat-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest Por Categoria' })).token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest Por Categoria', date: '2026-12-12', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;

    // Duas categorias de níveis diferentes, para a ordem entre elas ser
    // determinística (iniciante antes de scale, ver categorySortKey).
    categoriaA = campeonato.body.data.categories.find((c) => c.name === 'Iniciante Feminino').id;
    categoriaB = campeonato.body.data.categories.find((c) => c.name === 'Scale Feminino').id;

    await request(app)
      .put(`/api/championships/${championshipId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lanes_per_heat: 4 });

    for (const [prefixo, categoria] of [['A', categoriaA], ['B', categoriaB]]) {
      for (let i = 1; i <= 5; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await request(app)
          .post('/api/teams')
          .set('Authorization', `Bearer ${token}`)
          .send({
            championship_id: championshipId,
            category_id: categoria,
            name: `Equipe ${prefixo}${i}`,
          });
      }
    }

    for (const numero of [1, 2]) {
      // eslint-disable-next-line no-await-in-loop
      const prova = await request(app)
        .post('/api/workouts')
        .set('Authorization', `Bearer ${token}`)
        .send({
          championship_id: championshipId,
          workout_number: numero,
          name: `WOD Por Categoria ${numero}`,
          scoring_type: 'time',
        });
      if (numero === 1) provaMisturada = prova.body.data.id;
      else provaSeparada = prova.body.data.id;
    }
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('sem a opção, o comportamento é o de hoje: 3 baterias e uma delas mista', async () => {
    const res = await request(app)
      .post(`/api/workouts/${provaMisturada}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);

    const heats = (await request(app).get(`/api/workouts/${provaMisturada}/heats`)).body.data;
    expect(heats).toHaveLength(3);
    expect(heats.map((h) => h.teams.length)).toEqual([4, 3, 3]);

    const mistas = categoriasPorBateria(heats).filter((cats) => cats.length > 1);
    expect(mistas).toHaveLength(1);
  });

  test('com group_by_category, nenhuma bateria mistura categorias', async () => {
    const res = await request(app)
      .post(`/api/workouts/${provaSeparada}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({ group_by_category: true });

    expect(res.status).toBe(201);

    const heats = (await request(app).get(`/api/workouts/${provaSeparada}/heats`)).body.data;

    for (const categorias of categoriasPorBateria(heats)) {
      expect(categorias).toHaveLength(1);
    }
  });

  test('a separação custa uma bateria a mais, e nenhuma equipe se perde', async () => {
    const heats = (await request(app).get(`/api/workouts/${provaSeparada}/heats`)).body.data;

    // 2 baterias por categoria (3 + 2), contra 3 no total quando misturado.
    expect(heats).toHaveLength(4);
    expect(heats.map((h) => h.teams.length)).toEqual([3, 2, 3, 2]);

    // O que não pode mudar entre os dois modos: todo mundo compete uma vez.
    expect(totalDeEquipes(heats)).toBe(10);
    const nomes = heats.flatMap((h) => h.teams.map((t) => t.team_name));
    expect(new Set(nomes).size).toBe(10);
  });

  test('a ordem das categorias continua sendo a fixa (iniciante antes de scale)', async () => {
    const heats = (await request(app).get(`/api/workouts/${provaSeparada}/heats`)).body.data;
    const sequencia = categoriasPorBateria(heats).map(([c]) => c);

    expect(sequencia).toEqual([
      'Iniciante Feminino',
      'Iniciante Feminino',
      'Scale Feminino',
      'Scale Feminino',
    ]);
  });

  test('group_by_category só vale quando é true de verdade, não "true" nem 1', async () => {
    // O controller testa `=== true`. Um valor achado de query string ou de
    // formulário mal montado não deve ligar a separação por acidente: o padrão
    // é o comportamento de produção, e mudar isso em silêncio na véspera do
    // evento é pior do que a opção não funcionar.
    await request(app)
      .post(`/api/workouts/${provaMisturada}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({ group_by_category: 'true', force: true });

    const heats = (await request(app).get(`/api/workouts/${provaMisturada}/heats`)).body.data;
    expect(heats).toHaveLength(3);
  });
});
