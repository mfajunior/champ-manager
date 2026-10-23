const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * DELETE /api/workouts/:workout_id/heats — apagar as baterias de uma prova.
 *
 * O que mais importa aqui não é o DELETE em si, é o efeito colateral: apagar
 * as baterias de uma prova tem que encurtar o dia e fazer as provas seguintes
 * SUBIREM no cronograma. Sem isso elas ficariam nos horários antigos e o dia
 * abriria um buraco do tamanho da prova apagada.
 *
 * Campeonato próprio, com duas provas de 2 baterias cada (4 equipes, 2 raias,
 * time cap de 10 min, transição de 1 min, início 08:00), para os horários
 * serem previsíveis e verificáveis um a um.
 */
describe('Heats — limpar as baterias de uma prova (integração com banco real)', () => {
  let token;
  let championshipId;
  let categoriaId;
  let provaUmId;
  let provaDoisId;
  const equipes = {};

  const auth = () => ({ Authorization: `Bearer ${token}` });

  const horariosDa = async (provaId) => {
    const res = await request(app).get(`/api/workouts/${provaId}/heats`);
    return res.body.data.map((h) => h.scheduled_time?.slice(11, 16) ?? null);
  };

  const baterias = async (provaId) =>
    (await request(app).get(`/api/workouts/${provaId}/heats`)).body.data;

  beforeAll(async () => {
    const email = `jest-limpar-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest Limpar' })).token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set(auth())
      .send({ name: 'Jest Limpar Championship', date: '2026-12-19', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;
    categoriaId = campeonato.body.data.categories[0].id;

    await request(app)
      .put(`/api/championships/${championshipId}`)
      .set(auth())
      .send({ lanes_per_heat: 2, transition_seconds: 60, start_time: '08:00' });

    for (const nome of ['L1', 'L2', 'L3', 'L4']) {
      // eslint-disable-next-line no-await-in-loop
      const criada = await request(app)
        .post('/api/teams')
        .set(auth())
        .send({ championship_id: championshipId, category_id: categoriaId, name: nome });
      equipes[nome] = criada.body.data.id;
    }

    for (const numero of [1, 2]) {
      // eslint-disable-next-line no-await-in-loop
      const prova = await request(app)
        .post('/api/workouts')
        .set(auth())
        .send({
          championship_id: championshipId,
          workout_number: numero,
          name: `WOD Limpar ${numero}`,
          scoring_type: 'time',
        });
      const id = prova.body.data.id;
      if (numero === 1) provaUmId = id;
      else provaDoisId = id;

      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .put(`/api/workouts/${id}/variants/${categoriaId}`)
        .set(auth())
        .send({ description: 'WOD de teste', time_cap_seconds: 600 });
    }

    await request(app).post(`/api/workouts/${provaUmId}/heats`).set(auth()).send({});
    await request(app).post(`/api/workouts/${provaDoisId}/heats`).set(auth()).send({});
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('o cenário começa com as duas provas agendadas em sequência', async () => {
    expect(await horariosDa(provaUmId)).toEqual(['08:00', '08:11']);
    expect(await horariosDa(provaDoisId)).toEqual(['08:22', '08:33']);
  });

  test('sem token é 401', async () => {
    const res = await request(app).delete(`/api/workouts/${provaUmId}/heats`);
    expect(res.status).toBe(401);
  });

  test('prova inexistente é 404', async () => {
    const res = await request(app).delete('/api/workouts/99999999/heats').set(auth());
    expect(res.status).toBe(404);
  });

  test('apaga as baterias da prova 2 e devolve quantas foram', async () => {
    const res = await request(app).delete(`/api/workouts/${provaDoisId}/heats`).set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.heats_deleted).toBe(2);
    expect(await baterias(provaDoisId)).toHaveLength(0);
  });

  test('a prova 1 não foi tocada', async () => {
    expect(await horariosDa(provaUmId)).toEqual(['08:00', '08:11']);
  });

  test('limpar de novo a mesma prova é 404, não 200 em silêncio', async () => {
    const res = await request(app).delete(`/api/workouts/${provaDoisId}/heats`).set(auth());
    expect(res.status).toBe(404);
  });

  test('apagar a prova 1 faz a prova 2 SUBIR no cronograma', async () => {
    // Regera a 2 para ela voltar a existir, depois do fim da 1.
    await request(app).post(`/api/workouts/${provaDoisId}/heats`).set(auth()).send({});
    expect(await horariosDa(provaDoisId)).toEqual(['08:22', '08:33']);

    await request(app).delete(`/api/workouts/${provaUmId}/heats`).set(auth());

    // Sem a prova 1 ocupando o começo do dia, a 2 assume o início configurado.
    // É esta asserção que prova que a agenda foi recalculada, e não só que as
    // linhas foram apagadas.
    expect(await horariosDa(provaDoisId)).toEqual(['08:00', '08:11']);
  });

  test('com resultado lançado, recusa com 409 e diz quantos estão em risco', async () => {
    // Regera a prova 1 e lança um resultado nela.
    await request(app).post(`/api/workouts/${provaUmId}/heats`).set(auth()).send({});
    const heats = await baterias(provaUmId);
    const raia = heats[0].teams[0];

    await request(app)
      .post('/api/results')
      .set(auth())
      .send({ heat_team_id: raia.heat_team_id, raw_value: 300 });

    const res = await request(app).delete(`/api/workouts/${provaUmId}/heats`).set(auth());

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESULTS_EXIST');
    expect(res.body.meta.results_at_risk).toBe(1);
    // Nada apagado: o 409 é recusa, não aviso.
    expect(await baterias(provaUmId)).toHaveLength(2);
  });

  test('com force=true apaga mesmo com resultado, e o placar é recalculado', async () => {
    const antes = await request(app).get(`/api/leaderboard?championship_id=${championshipId}`);
    const pontuou = antes.body.data.filter((l) => l.place !== null);
    expect(pontuou.length).toBeGreaterThan(0);

    const res = await request(app)
      .delete(`/api/workouts/${provaUmId}/heats?force=true`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(await baterias(provaUmId)).toHaveLength(0);

    // O resultado foi em cascata com a raia, e o trigger de DELETE em heats
    // (migration 010) refez o placar: ninguém mais tem colocação.
    const depois = await request(app).get(`/api/leaderboard?championship_id=${championshipId}`);
    expect(depois.body.data.every((l) => l.place === null)).toBe(true);
  });

  test('force só vale como a string "true" na query, não qualquer valor', async () => {
    await request(app).post(`/api/workouts/${provaUmId}/heats`).set(auth()).send({});
    const heats = await baterias(provaUmId);
    await request(app)
      .post('/api/results')
      .set(auth())
      .send({ heat_team_id: heats[0].teams[0].heat_team_id, raw_value: 400 });

    const res = await request(app)
      .delete(`/api/workouts/${provaUmId}/heats?force=1`)
      .set(auth());

    // ?force=1 não é confirmação. O padrão é proteger os lançamentos.
    expect(res.status).toBe(409);
  });
});
