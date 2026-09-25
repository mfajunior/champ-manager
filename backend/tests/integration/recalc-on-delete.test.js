const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * O placar é recalculado por um caminho só: o trigger em `results`. Ele
 * descobre qual prova recalcular subindo de results para heat_teams. Quando o
 * que some é a BATERIA (ou a prova, ou a equipe), o cascade derruba heat_teams
 * junto e o trigger não acha mais a prova — nada era recalculado, e o placar
 * público continuava somando resultados que não existiam mais.
 *
 * A migration 010 fecha os três caminhos. Este arquivo prova os três contra o
 * banco de verdade, porque o bug mora justamente na ordem em que o Postgres
 * executa os cascades — coisa que teste com mock não enxerga.
 *
 * Campeonato próprio, 3 equipes numa categoria, 3 raias (uma bateria por
 * prova), para os números do placar serem conferíveis de cabeça.
 */
describe('Recálculo do placar ao apagar bateria, prova ou equipe', () => {
  let token;
  let championshipId;
  let categoriaId;
  let provaUmId;
  let provaDoisId;
  const equipes = {}; // nome -> id

  const placar = async () => {
    const res = await request(app).get(`/api/leaderboard?championship_id=${championshipId}`);
    return Object.fromEntries(
      res.body.data.map((l) => [
        l.team_name,
        { place: l.place, total: Number(l.total_score), provas: Number(l.workouts_completed) },
      ])
    );
  };

  const lancarResultados = async (provaId, temposPorNome) => {
    const baterias = await request(app).get(`/api/workouts/${provaId}/heats`);
    const raias = baterias.body.data.flatMap((h) => h.teams);
    for (const raia of raias) {
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post('/api/results')
        .set('Authorization', `Bearer ${token}`)
        .send({ heat_team_id: raia.heat_team_id, raw_value: temposPorNome[raia.team_name] });
    }
  };

  beforeAll(async () => {
    const email = `jest-recalc-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest Recalc' })).token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest Recalc Championship', date: '2026-12-06', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;
    categoriaId = campeonato.body.data.categories[0].id;

    await request(app)
      .put(`/api/championships/${championshipId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lanes_per_heat: 3 });

    for (const nome of ['Alpha', 'Bravo', 'Charlie']) {
      // eslint-disable-next-line no-await-in-loop
      const criada = await request(app)
        .post('/api/teams')
        .set('Authorization', `Bearer ${token}`)
        .send({ championship_id: championshipId, category_id: categoriaId, name: nome });
      equipes[nome] = criada.body.data.id;
    }

    for (const numero of [1, 2]) {
      // eslint-disable-next-line no-await-in-loop
      const prova = await request(app)
        .post('/api/workouts')
        .set('Authorization', `Bearer ${token}`)
        .send({
          championship_id: championshipId,
          workout_number: numero,
          name: `WOD Recalc ${numero}`,
          scoring_type: 'time',
        });
      if (numero === 1) provaUmId = prova.body.data.id;
      else provaDoisId = prova.body.data.id;
    }

    for (const provaId of [provaUmId, provaDoisId]) {
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post(`/api/workouts/${provaId}/heats`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
    }
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('duas provas lançadas: cada equipe soma 4 e tem 2 provas completas', async () => {
    // Prova 1: Alpha 1º, Bravo 2º, Charlie 3º
    await lancarResultados(provaUmId, { Alpha: 100, Bravo: 200, Charlie: 300 });
    // Prova 2: o inverso — Charlie 1º, Bravo 2º, Alpha 3º
    await lancarResultados(provaDoisId, { Charlie: 100, Bravo: 200, Alpha: 300 });

    const p = await placar();
    expect(p.Alpha).toMatchObject({ total: 4, provas: 2 });
    expect(p.Bravo).toMatchObject({ total: 4, provas: 2 });
    expect(p.Charlie).toMatchObject({ total: 4, provas: 2 });
  });

  test('regerar as baterias da prova 2 tira os resultados dela do placar', async () => {
    const res = await request(app)
      .post(`/api/workouts/${provaDoisId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({ force: true });
    expect(res.status).toBe(201);

    const p = await placar();
    // Sobra só a prova 1: a soma vira a própria colocação nela.
    expect(p.Alpha).toMatchObject({ total: 1, place: 1, provas: 1 });
    expect(p.Bravo).toMatchObject({ total: 2, place: 2, provas: 1 });
    expect(p.Charlie).toMatchObject({ total: 3, place: 3, provas: 1 });
  });

  test('apagar a prova 1 inteira tira os resultados dela do placar', async () => {
    await lancarResultados(provaDoisId, { Charlie: 100, Bravo: 200, Alpha: 300 });

    const res = await request(app)
      .delete(`/api/workouts/${provaUmId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const p = await placar();
    // Sobra só a prova 2, que era o inverso da 1.
    expect(p.Charlie).toMatchObject({ total: 1, place: 1, provas: 1 });
    expect(p.Bravo).toMatchObject({ total: 2, place: 2, provas: 1 });
    expect(p.Alpha).toMatchObject({ total: 3, place: 3, provas: 1 });
  });

  test('apagar uma equipe re-rankeia quem estava atrás dela', async () => {
    const res = await request(app)
      .delete(`/api/teams/${equipes.Bravo}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const p = await placar();
    expect(p.Bravo).toBeUndefined();
    // Sem a Bravo, a prova 2 vira Charlie 1º e Alpha 2º.
    expect(p.Charlie).toMatchObject({ total: 1, place: 1 });
    expect(p.Alpha).toMatchObject({ total: 2, place: 2 });
  });
});
