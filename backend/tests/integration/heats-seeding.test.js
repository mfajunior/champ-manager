const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * order_by_standings: gerar as baterias na ordem do leaderboard, do pior
 * colocado para o melhor, em vez da ordem de cadastro.
 *
 * Arquivo separado do heats.test.js de propósito: aquele acumula estado
 * entre os testes (gera, lança resultado, regenera com force) e inserir
 * mais um cenário no meio mudaria o estado que os seguintes assumem. Aqui o
 * campeonato é próprio, com 4 equipes numa categoria só e 2 raias — o
 * suficiente pra ter 2 baterias e poder afirmar quem está em qual.
 */
describe('Heats — ordenação pelo leaderboard (integração com banco real)', () => {
  let token;
  let championshipId;
  let categoriaId;
  let provaUmId;
  let provaDoisId;
  const equipes = {}; // nome -> id

  const nomesNaOrdem = (heats) => heats.map((h) => h.teams.map((t) => t.team_name));

  beforeAll(async () => {
    const email = `jest-seeding-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest Seeding' })).token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest Seeding Championship', date: '2026-12-05', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;
    categoriaId = campeonato.body.data.categories[0].id;

    await request(app)
      .put(`/api/championships/${championshipId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lanes_per_heat: 2 });

    // Cadastradas em ordem alfabética: A é a mais antiga (menor id), D a mais
    // nova. É essa a ordem padrão, e é dela que o seeding tem que divergir.
    for (const nome of ['Seed A', 'Seed B', 'Seed C', 'Seed D']) {
      const criada = await request(app)
        .post('/api/teams')
        .set('Authorization', `Bearer ${token}`)
        .send({ championship_id: championshipId, category_id: categoriaId, name: nome });
      equipes[nome] = criada.body.data.id;
    }

    for (const numero of [1, 2]) {
      const prova = await request(app)
        .post('/api/workouts')
        .set('Authorization', `Bearer ${token}`)
        .send({
          championship_id: championshipId,
          workout_number: numero,
          name: `WOD Seeding ${numero}`,
          scoring_type: 'time',
        });
      if (numero === 1) provaUmId = prova.body.data.id;
      else provaDoisId = prova.body.data.id;
    }
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('sem ninguém pontuado ainda, a opção não muda a ordem (cai no desempate por cadastro)', async () => {
    const res = await request(app)
      .post(`/api/workouts/${provaUmId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({ order_by_standings: true });

    expect(res.status).toBe(201);
    expect(res.body.meta.orderedByStandings).toBe(true);
    // Todas com place null -> ordenação empata em tudo e sobra o id.
    expect(nomesNaOrdem(res.body.data)).toEqual([
      ['Seed A', 'Seed B'],
      ['Seed C', 'Seed D'],
    ]);
  });

  test('resultados da prova 1 formam o leaderboard (A em 1º, D em 4º)', async () => {
    const baterias = await request(app).get(`/api/workouts/${provaUmId}/heats`);
    const raias = baterias.body.data.flatMap((h) => h.teams);

    // scoring_type 'time': menor vence. A mais rápida, D a mais lenta.
    const tempos = { 'Seed A': 100, 'Seed B': 200, 'Seed C': 300, 'Seed D': 400 };
    for (const raia of raias) {
      await request(app)
        .post('/api/results')
        .set('Authorization', `Bearer ${token}`)
        .send({ heat_team_id: raia.heat_team_id, raw_value: tempos[raia.team_name] });
    }

    const leaderboard = await request(app).get(`/api/leaderboard?championship_id=${championshipId}`);
    const porNome = Object.fromEntries(leaderboard.body.data.map((l) => [l.team_name, l.place]));

    expect(porNome['Seed A']).toBe(1);
    expect(porNome['Seed B']).toBe(2);
    expect(porNome['Seed C']).toBe(3);
    expect(porNome['Seed D']).toBe(4);
  });

  test('com o leaderboard formado, a prova 2 gera do pior para o melhor', async () => {
    const res = await request(app)
      .post(`/api/workouts/${provaDoisId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({ order_by_standings: true });

    expect(res.status).toBe(201);
    // A líder vai pra última raia da última bateria; a lanterna abre o dia.
    expect(nomesNaOrdem(res.body.data)).toEqual([
      ['Seed D', 'Seed C'],
      ['Seed B', 'Seed A'],
    ]);
  });

  test('sem a opção, a prova 2 volta à ordem de cadastro mesmo com leaderboard formado', async () => {
    const res = await request(app)
      .post(`/api/workouts/${provaDoisId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.meta.orderedByStandings).toBe(false);
    expect(nomesNaOrdem(res.body.data)).toEqual([
      ['Seed A', 'Seed B'],
      ['Seed C', 'Seed D'],
    ]);
  });
});
