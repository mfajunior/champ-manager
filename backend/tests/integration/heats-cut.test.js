const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * Geração de baterias com corte por prova.
 *
 * Arquivo próprio, como heats-seeding.test.js: o heats.test.js acumula estado
 * entre os testes (gera, lança, regenera com force) e inserir um cenário no
 * meio mudaria o que os seguintes assumem.
 *
 * O que importa provar aqui é que a lista de quem entra na raia vem da MESMA
 * função que a tela de cortes consulta. Duas noções de "top 3" — uma no
 * controller, outra no banco — divergiriam no primeiro empate, e o organizador
 * chamaria no microfone uma equipe que o painel não mostra.
 */
describe('Baterias — corte por prova', () => {
  let token;
  let championshipId;
  let categoriaId;
  let provaUmId;
  let provaDoisId;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  const nomesEscalados = async (provaId) => {
    const res = await request(app).get(`/api/workouts/${provaId}/heats`);
    return res.body.data
      .flatMap((h) => h.teams)
      .map((t) => t.team_name)
      .sort();
  };

  beforeAll(async () => {
    const email = `jest-cut-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest Cut' })).token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set(auth())
      .send({ name: 'Jest Cut Championship', date: '2026-12-11', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;
    categoriaId = campeonato.body.data.categories[0].id;

    await request(app)
      .put(`/api/championships/${championshipId}`)
      .set(auth())
      .send({ lanes_per_heat: 5 });

    for (const nome of ['T1', 'T2', 'T3', 'T4', 'T5']) {
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post('/api/teams')
        .set(auth())
        .send({ championship_id: championshipId, category_id: categoriaId, name: nome });
    }

    for (const numero of [1, 2]) {
      // eslint-disable-next-line no-await-in-loop
      const prova = await request(app)
        .post('/api/workouts')
        .set(auth())
        .send({
          championship_id: championshipId,
          workout_number: numero,
          name: `WOD Cut ${numero}`,
          scoring_type: 'time',
        });
      if (numero === 1) provaUmId = prova.body.data.id;
      else provaDoisId = prova.body.data.id;
    }

    const tabela = await request(app)
      .post(`/api/championships/${championshipId}/points-tables`)
      .set(auth())
      .send({
        name: 'Padrão',
        ranges: [{ start_place: 1, end_place: null, decrement: 5 }],
      });

    await request(app)
      .put(`/api/championships/${championshipId}/scoring-model`)
      .set(auth())
      .send({
        scoring_model: 'points_table',
        points_table_id: tabela.body.data.id,
        confirm: true,
      });

    // Prova 1: T1 vence, T5 é a última.
    await request(app).post(`/api/workouts/${provaUmId}/heats`).set(auth()).send({});
    const baterias = await request(app).get(`/api/workouts/${provaUmId}/heats`);
    const tempos = { T1: 100, T2: 200, T3: 300, T4: 400, T5: 500 };
    for (const raia of baterias.body.data.flatMap((h) => h.teams)) {
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post('/api/results')
        .set(auth())
        .send({ heat_team_id: raia.heat_team_id, raw_value: tempos[raia.team_name] });
    }
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query(
        `UPDATE championships SET scoring_model = 'legacy', points_table_id = NULL WHERE id = $1`,
        [championshipId]
      );
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('sem corte, todas as equipes entram — comportamento inalterado', async () => {
    const res = await request(app)
      .post(`/api/workouts/${provaDoisId}/heats`)
      .set(auth())
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.meta.cutApplied).toBe(false);
    expect(res.body.meta.totalTeams).toBe(5);
    expect(await nomesEscalados(provaDoisId)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
  });

  test('com corte no top 3, só as classificadas entram na raia', async () => {
    await request(app)
      .put(`/api/workouts/${provaDoisId}/cut`)
      .set(auth())
      .send({ keep_top_n: 3 });

    const res = await request(app)
      .post(`/api/workouts/${provaDoisId}/heats`)
      .set(auth())
      .send({ force: true });

    expect(res.status).toBe(201);
    expect(res.body.meta.cutApplied).toBe(true);
    expect(res.body.meta.totalTeams).toBe(3);
    expect(await nomesEscalados(provaDoisId)).toEqual(['T1', 'T2', 'T3']);
  });

  test('a escalação bate com o que o endpoint de classificados diz', async () => {
    const elegiveis = await request(app).get(`/api/workouts/${provaDoisId}/eligible-teams`);
    const rx = elegiveis.body.data.find((c) => c.category_id === categoriaId);

    expect(rx.eligible.map((e) => e.team_name).sort()).toEqual(await nomesEscalados(provaDoisId));
    // Geradas DEPOIS do corte: nada a regerar.
    expect(rx.outdated).toBe(false);
    expect(elegiveis.body.meta.any_outdated).toBe(false);
  });

  test('corte maior que o número de equipes não quebra nada', async () => {
    await request(app)
      .put(`/api/workouts/${provaDoisId}/cut`)
      .set(auth())
      .send({ keep_top_n: 99 });

    const res = await request(app)
      .post(`/api/workouts/${provaDoisId}/heats`)
      .set(auth())
      .send({ force: true });

    expect(res.status).toBe(201);
    expect(res.body.meta.totalTeams).toBe(5);
  });

  test('remover o corte traz todo mundo de volta na próxima geração', async () => {
    await request(app).delete(`/api/workouts/${provaDoisId}/cut`).set(auth());

    const res = await request(app)
      .post(`/api/workouts/${provaDoisId}/heats`)
      .set(auth())
      .send({ force: true });

    expect(res.body.meta.cutApplied).toBe(false);
    expect(await nomesEscalados(provaDoisId)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
  });

  test('a prova cortada não apaga os pontos de quem ficou de fora', async () => {
    await request(app)
      .put(`/api/workouts/${provaDoisId}/cut`)
      .set(auth())
      .send({ keep_top_n: 3 });

    const placar = await request(app).get(`/api/leaderboard?championship_id=${championshipId}`);
    const t5 = placar.body.data.find((l) => l.team_name === 'T5');

    expect(t5.is_cut).toBe(true);
    expect(t5.total_points).toBe(80); // 100 - 4 * 5, o que conquistou na prova 1
  });
});
