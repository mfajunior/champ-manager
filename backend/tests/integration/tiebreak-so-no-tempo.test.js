const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * O desempate vale SÓ para a pontuação de tempo (migration 019).
 *
 * O tiebreak do CrossFit é um tempo parcial anotado durante o WOD: ele separa
 * quem chegou ao mesmo resultado no relógio. Em repetições ou carga ele não
 * significa nada — duas equipes com as mesmas reps empataram, ponto.
 *
 * O CENÁRIO é desenhado para que a regra errada e a certa deem resultados
 * DIFERENTES na mesma prova. Mesma dupla de equipes, empatada nas duas
 * pontuações, com tempos parciais distintos:
 *
 *   equipe   tempo    desempate   reps    →  coloc. tempo   coloc. reps
 *   X        300s     40s         120        1º             1º (empate)
 *   Y        300s     55s         120        2º             1º (empate)
 *   Z        500s     —            80        3º             3º
 *
 * No tempo, o desempate DECIDE: X na frente de Y, porque 40 < 55.
 * Nas reps, o desempate NÃO pode decidir: as duas em 1º, e Z pula para 3º,
 * que é como o RANK() representa empate.
 *
 * Antes da 019 o desempate entrava nas duas pontuações e as reps saíam 1º e
 * 2º — uma ordenação decidida por um número que não tem relação com quantas
 * repetições cada uma fez.
 */
describe('Desempate só na pontuação de tempo (integração com banco real)', () => {
  let token;
  let championshipId;
  let workoutId;
  let categoryId;
  const raias = {};

  const auth = () => ({ Authorization: `Bearer ${token}` });

  // Colocações por equipe, separadas por pontuação, lidas da raia.
  const colocacoes = async () => {
    const heats = await request(app).get(`/api/workouts/${workoutId}/heats`);
    const mapa = {};
    for (const heat of heats.body.data) {
      for (const lane of heat.teams) {
        mapa[lane.team_name.replace('Equipe ', '')] = {
          tempo: lane.place,
          reps: lane.place_2,
        };
      }
    }
    return mapa;
  };

  beforeAll(async () => {
    const email = `jest-tb-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest Tiebreak' })).token;

    const camp = await request(app)
      .post('/api/championships')
      .set(auth())
      .send({ name: 'Jest Tiebreak', date: '2026-12-27', location: 'Box Jest' });
    championshipId = camp.body.data.id;
    categoryId = camp.body.data.categories[0].id;

    for (const nome of ['X', 'Y', 'Z']) {
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post('/api/teams')
        .set(auth())
        .send({ championship_id: championshipId, category_id: categoryId, name: `Equipe ${nome}` });
    }

    const prova = await request(app)
      .post('/api/workouts')
      .set(auth())
      .send({
        championship_id: championshipId,
        workout_number: 1,
        name: 'WOD Tiebreak',
        scoring_type: 'time',
      });
    workoutId = prova.body.data.id;

    await request(app)
      .put(`/api/workouts/${workoutId}`)
      .set(auth())
      .send({ scoring_type_2: 'reps', has_tiebreak: true });

    await request(app)
      .put(`/api/championships/${championshipId}`)
      .set(auth())
      .send({ lanes_per_heat: 4 });

    await request(app).post(`/api/workouts/${workoutId}/heats`).set(auth()).send({});

    const heats = await request(app).get(`/api/workouts/${workoutId}/heats`);
    for (const lane of heats.body.data[0].teams) {
      raias[lane.team_name.replace('Equipe ', '')] = lane.heat_team_id;
    }

    const lancar = async (nome, tempo, desempate, reps) => {
      await request(app)
        .post('/api/results')
        .set(auth())
        .send({ heat_team_id: raias[nome], raw_value: tempo, score_index: 1, tiebreak_seconds: desempate });
      await request(app)
        .post('/api/results')
        .set(auth())
        .send({ heat_team_id: raias[nome], raw_value: reps, score_index: 2, tiebreak_seconds: desempate });
    };

    await lancar('X', 300, 40, 120);
    await lancar('Y', 300, 55, 120);
    await lancar('Z', 500, null, 80);
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('na pontuação de TEMPO o desempate decide: menor parcial na frente', async () => {
    const c = await colocacoes();
    expect(c.X.tempo).toBe(1); // 300s, parcial 40
    expect(c.Y.tempo).toBe(2); // 300s, parcial 55
    expect(c.Z.tempo).toBe(3); // 500s
  });

  test('na pontuação de REPS o desempate NÃO decide: empate de verdade', async () => {
    const c = await colocacoes();
    // 120 reps as duas: dividem o 1º. É o caso que a 019 corrige — antes
    // saíam 1º e 2º, ordenadas pelo tempo parcial.
    expect(c.X.reps).toBe(1);
    expect(c.Y.reps).toBe(1);
  });

  test('o empate nas reps faz o RANK() pular a posição seguinte', async () => {
    const c = await colocacoes();
    // Duas em 1º, então a próxima é a 3ª — nunca a 2ª. É assim que um
    // campeonato registra empate, e é o que prova que houve empate mesmo,
    // em vez de uma ordenação que por acaso coincidiu.
    expect(c.Z.reps).toBe(3);
  });

  test('corrigir o parcial reordena o tempo e não mexe nas reps', async () => {
    // Y passa a ter o melhor parcial; a colocação no tempo inverte.
    const heats = await request(app).get(`/api/workouts/${workoutId}/heats`);
    const laneY = heats.body.data[0].teams.find((l) => l.team_name === 'Equipe Y');

    await request(app)
      .put(`/api/results/${laneY.result_id}`)
      .set(auth())
      .send({ tiebreak_seconds: 20 });

    const c = await colocacoes();
    expect(c.Y.tempo).toBe(1);
    expect(c.X.tempo).toBe(2);
    // E as reps continuam empatadas, intocadas pelo parcial.
    expect(c.X.reps).toBe(1);
    expect(c.Y.reps).toBe(1);
    expect(c.Z.reps).toBe(3);
  });
});
