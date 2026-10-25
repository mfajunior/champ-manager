const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * schedule_only: baterias com horário e sem escalação.
 *
 * O caso de uso é a prova que depende do corte da anterior — ela só tem
 * equipes definidas depois que a anterior termina, mas precisa de lugar no
 * cronograma antes disso.
 *
 * O que estes testes precisam provar, além de "criou bateria": que o número de
 * baterias sai do corte CONFIGURADO (não dos classificados, que ainda não
 * existem), que a prova entra na agenda e empurra as seguintes, e que ela não
 * destrói escalação já feita.
 */
describe('Heats — só o cronograma (integração com banco real)', () => {
  let token;
  let championshipId;
  let catA;
  let catB;
  let provaUm;
  let provaDois;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const baterias = async (id) =>
    (await request(app).get(`/api/workouts/${id}/heats`)).body.data;
  const horarios = async (id) =>
    (await baterias(id)).map((h) => h.scheduled_time?.slice(11, 16) ?? null);

  beforeAll(async () => {
    const email = `jest-crono-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest Cronograma' })).token;

    const camp = await request(app)
      .post('/api/championships')
      .set(auth())
      .send({ name: 'Jest Cronograma', date: '2026-12-26', location: 'Box Jest' });
    championshipId = camp.body.data.id;
    catA = camp.body.data.categories.find((c) => c.name === 'Iniciante Feminino').id;
    catB = camp.body.data.categories.find((c) => c.name === 'Scale Feminino').id;

    await request(app)
      .put(`/api/championships/${championshipId}`)
      .set(auth())
      .send({ lanes_per_heat: 4, transition_seconds: 60, start_time: '08:00' });

    // 5 equipes em cada categoria, 10 no total.
    for (const [prefixo, cat] of [['A', catA], ['B', catB]]) {
      for (let i = 1; i <= 5; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await request(app)
          .post('/api/teams')
          .set(auth())
          .send({ championship_id: championshipId, category_id: cat, name: `Crono ${prefixo}${i}` });
      }
    }

    for (const numero of [1, 2]) {
      // eslint-disable-next-line no-await-in-loop
      const prova = await request(app)
        .post('/api/workouts')
        .set(auth())
        .send({
          championship_id: championshipId,
          workout_number: numero,
          name: `WOD Crono ${numero}`,
          scoring_type: 'time',
        });
      const id = prova.body.data.id;
      if (numero === 1) provaUm = id;
      else provaDois = id;

      for (const cat of [catA, catB]) {
        // eslint-disable-next-line no-await-in-loop
        await request(app)
          .put(`/api/workouts/${id}/variants/${cat}`)
          .set(auth())
          .send({ description: 'WOD de teste', time_cap_seconds: 600 });
      }
    }
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('cria baterias com horário, sem nenhuma equipe', async () => {
    const res = await request(app)
      .post(`/api/workouts/${provaUm}/heats`)
      .set(auth())
      .send({ schedule_only: true });

    expect(res.status).toBe(201);
    expect(res.body.meta.scheduleOnly).toBe(true);
    expect(res.body.meta.teamsConsidered).toBe(10);

    const heats = await baterias(provaUm);
    // 10 equipes em 4 raias = 3 baterias (4, 3, 3)
    expect(heats).toHaveLength(3);
    expect(heats.every((h) => h.teams.length === 0)).toBe(true);
    expect(heats.map((h) => h.planned_lanes)).toEqual([4, 3, 3]);
    expect(await horarios(provaUm)).toEqual(['08:00', '08:11', '08:22']);
  });

  test('a prova de cronograma entra na agenda e empurra as seguintes', async () => {
    await request(app).post(`/api/workouts/${provaDois}/heats`).set(auth()).send({});

    // A prova 1 ocupa 3 baterias de 10 min + 1 min; a 2 começa depois dela.
    expect((await horarios(provaDois))[0]).toBe('08:33');
  });

  test('prova que já tem baterias é recusada com 409', async () => {
    const res = await request(app)
      .post(`/api/workouts/${provaDois}/heats`)
      .set(auth())
      .send({ schedule_only: true });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HEATS_EXIST');
    // A escalação da prova 2 continua intacta.
    const heats = await baterias(provaDois);
    expect(heats.some((h) => h.teams.length > 0)).toBe(true);
  });

  test('o corte configurado reduz o número de baterias', async () => {
    await request(app).delete(`/api/workouts/${provaUm}/heats`).set(auth());

    // top 2 por categoria: 4 equipes no total, não 10.
    await request(app)
      .put(`/api/workouts/${provaUm}/cut`)
      .set(auth())
      .send({ keep_top_n: 2 });

    const res = await request(app)
      .post(`/api/workouts/${provaUm}/heats`)
      .set(auth())
      .send({ schedule_only: true });

    expect(res.status).toBe(201);
    expect(res.body.meta.teamsConsidered).toBe(4);
    expect(res.body.meta.cutApplied).toBe(true);

    // 4 vagas em 4 raias = 1 bateria.
    const heats = await baterias(provaUm);
    expect(heats).toHaveLength(1);
    expect(heats[0].planned_lanes).toBe(4);
  });

  test('corte maior que o número de inscritas não inventa equipe', async () => {
    await request(app).delete(`/api/workouts/${provaUm}/heats`).set(auth());
    await request(app)
      .put(`/api/workouts/${provaUm}/cut`)
      .set(auth())
      .send({ keep_top_n: 99 });

    const res = await request(app)
      .post(`/api/workouts/${provaUm}/heats`)
      .set(auth())
      .send({ schedule_only: true });

    // 5 por categoria é o teto real, então volta às 10 de antes.
    expect(res.body.meta.teamsConsidered).toBe(10);
  });

  test('com group_by_category, o cronograma usa a mesma regra da escalação', async () => {
    await request(app).delete(`/api/workouts/${provaUm}/heats`).set(auth());
    await request(app).delete(`/api/workouts/${provaUm}/cut`).set(auth());

    await request(app)
      .post(`/api/workouts/${provaUm}/heats`)
      .set(auth())
      .send({ schedule_only: true, group_by_category: true });

    // Separado: cada categoria de 5 vira 2 baterias (3, 2) -> 4 no total,
    // contra as 3 do modo misturado. É o mesmo número que a escalação real
    // daria, que é o ponto de reusar chunkIntoHeats.
    const heats = await baterias(provaUm);
    expect(heats).toHaveLength(4);
    expect(heats.map((h) => h.planned_lanes)).toEqual([3, 2, 3, 2]);
  });

  test('gerar a escalação por cima substitui o cronograma e zera planned_lanes', async () => {
    await request(app).delete(`/api/workouts/${provaUm}/heats`).set(auth());
    await request(app)
      .post(`/api/workouts/${provaUm}/heats`)
      .set(auth())
      .send({ schedule_only: true });
    expect((await baterias(provaUm))[0].planned_lanes).toBe(4);

    // Limpa e gera de verdade — o fluxo que o organizador segue quando as
    // equipes ficam definidas.
    await request(app).delete(`/api/workouts/${provaUm}/heats`).set(auth());
    await request(app).post(`/api/workouts/${provaUm}/heats`).set(auth()).send({});

    const heats = await baterias(provaUm);
    expect(heats.every((h) => h.planned_lanes === null)).toBe(true);
    expect(heats.reduce((s, h) => s + h.teams.length, 0)).toBe(10);
  });
});
