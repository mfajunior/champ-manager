const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * leaderboardController lê teams com LEFT JOIN em team_standings — quem
 * escreve em team_standings é o trigger do Postgres, disparado pelo
 * resultController (ver tests/integration/results.test.js). O que este
 * arquivo garante é a ponta de LEITURA: o filtro por categoria, e o caso
 * mais fácil de esquecer — campeonato com equipes cadastradas mas SEM
 * nenhum resultado lançado ainda não tem NENHUMA linha em team_standings
 * (a tabela cache só é escrita pelo trigger). Por isso a consulta parte de
 * teams, não de team_standings: toda equipe cadastrada aparece desde já,
 * com place null e total_score/workouts_completed em 0, até que exista um
 * resultado de verdade.
 */
describe('Leaderboard (integração com banco real)', () => {
  let token;
  let championshipId;
  let categoryId;
  let heatTeamId;

  beforeAll(async () => {
    const email = `jest-leader-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest Leaderboard' })).token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest Leaderboard Championship', date: '2026-11-15', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;
    categoryId = campeonato.body.data.categories[0].id;

    await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ championship_id: championshipId, category_id: categoryId, name: 'Equipe Solo' });

    const workout = await request(app)
      .post('/api/workouts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        championship_id: championshipId,
        workout_number: 1,
        name: 'WOD Leaderboard',
        scoring_type: 'time',
      });

    // lanes_per_heat virou parâmetro global do campeonato (migration 005) —
    // precisa ser definido antes de gerar baterias, não é mais enviado na
    // chamada de geração.
    await request(app)
      .put(`/api/championships/${championshipId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lanes_per_heat: 4 });

    await request(app)
      .post(`/api/workouts/${workout.body.data.id}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const heats = await request(app).get(`/api/workouts/${workout.body.data.id}/heats`);
    heatTeamId = heats.body.data[0].teams[0].heat_team_id;
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('GET / sem championship_id é rejeitado (400)', async () => {
    const res = await request(app).get('/api/leaderboard');
    expect(res.status).toBe(400);
  });

  test('championship_id inexistente devolve 404', async () => {
    const res = await request(app).get('/api/leaderboard?championship_id=999999999');
    expect(res.status).toBe(404);
  });

  test('antes de qualquer resultado lançado, a equipe cadastrada já aparece (sem posição)', async () => {
    const res = await request(app).get(`/api/leaderboard?championship_id=${championshipId}`);

    expect(res.status).toBe(200);
    // Equipe Solo já existe (criada no beforeAll) mesmo sem nenhum resultado
    // lançado ainda — o cliente precisa poder ver quem já está inscrito.
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].team_name).toBe('Equipe Solo');
    expect(res.body.data[0].place).toBeNull();
    expect(res.body.data[0].total_score).toBe(0);
    expect(res.body.data[0].workouts_completed).toBe(0);
    expect(res.body.meta.message).toMatch(/sucesso/i);
  });

  test('depois do primeiro resultado, a equipe aparece no leaderboard em 1º', async () => {
    await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id: heatTeamId, raw_value: 300 });

    const res = await request(app).get(`/api/leaderboard?championship_id=${championshipId}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].team_name).toBe('Equipe Solo');
    expect(res.body.data[0].place).toBe(1);
    expect(res.body.meta.message).toMatch(/sucesso/i);
  });

  test('category_id que não pertence ao campeonato é rejeitado (400)', async () => {
    const outroChampionship = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest Outro (leaderboard)', date: '2026-11-16', location: 'Box X' });
    const categoriaDeFora = outroChampionship.body.data.categories[0].id;

    const res = await request(app).get(
      `/api/leaderboard?championship_id=${championshipId}&category_id=${categoriaDeFora}`
    );

    expect(res.status).toBe(400);

    await pool.query('DELETE FROM championships WHERE id = $1', [outroChampionship.body.data.id]);
  });

  test('category_id válido filtra o leaderboard para aquela categoria', async () => {
    const res = await request(app).get(
      `/api/leaderboard?championship_id=${championshipId}&category_id=${categoryId}`
    );

    expect(res.status).toBe(200);
    expect(res.body.data.every((row) => row.category_id === categoryId)).toBe(true);
  });
});
