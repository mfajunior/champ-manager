const request = require('supertest');
const app = require('../../src/app');
const { pool } = require('../../src/config/database');

/**
 * Teste de integração: sobe o app Express de verdade (sem servidor HTTP nem
 * WebSocket — supertest fala direto com o app) contra um banco Postgres real
 * (champy_championship_test, migrado do mesmo jeito que o de desenvolvimento).
 *
 * É a versão automatizada do smoke-test-results.ps1: mesmo cenário (4
 * equipes, empate, DNF, correção, remoção), mas rodando com `npm test` em
 * vez de exigir o backend de pé numa outra janela.
 *
 * Por que testar isso e não só a função pura: o que mais importa neste
 * projeto é o trigger do Postgres (recalculate_placements + RANK), e isso só
 * existe no banco — não tem como testar sem bater numa conexão real.
 */
describe('Fluxo de resultados (integração com banco real)', () => {
  let token;
  let championshipId;
  let categoryId;
  let workoutId;
  const heatTeamIdByName = {};

  beforeAll(async () => {
    const email = `jest-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;

    const registro = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'jest12345', name: 'Jest Test' });
    token = registro.body.data.token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest Championship', date: '2026-12-01', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;
    categoryId = campeonato.body.data.categories[0].id;

    for (const nome of ['A', 'B', 'C', 'D']) {
      await request(app)
        .post('/api/teams')
        .set('Authorization', `Bearer ${token}`)
        .send({ championship_id: championshipId, category_id: categoryId, name: `Equipe ${nome}` });
    }

    const workout = await request(app)
      .post('/api/workouts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        championship_id: championshipId,
        workout_number: 1,
        name: 'WOD Jest',
        type: 'for_time',
        scoring_type: 'time',
      });
    workoutId = workout.body.data.id;

    await request(app)
      .post(`/api/workouts/${workoutId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category_id: categoryId, lanes_per_heat: 4 });

    const heats = await request(app).get(`/api/workouts/${workoutId}/heats`);
    heats.body.data[0].teams.forEach((t) => {
      heatTeamIdByName[t.team_name] = t.heat_team_id;
    });
  });

  afterAll(async () => {
    // DELETE em championships arrasta tudo por CASCADE (categorias, times,
    // provas, baterias e resultados) — não precisa limpar tabela por tabela.
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('setup criou 4 heat_team_id válidos', () => {
    expect(Object.keys(heatTeamIdByName)).toHaveLength(4);
    expect(heatTeamIdByName['Equipe A']).toBeDefined();
  });

  test('RANK(): empate divide posição e pula a próxima (1,2,2,4), DNF por último', async () => {
    const a = await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id: heatTeamIdByName['Equipe A'], raw_value: 600 });
    const b = await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id: heatTeamIdByName['Equipe B'], raw_value: 600 });
    const c = await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id: heatTeamIdByName['Equipe C'], raw_value: 500 });
    const d = await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id: heatTeamIdByName['Equipe D'], did_not_finish: true });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(c.status).toBe(201);
    expect(d.status).toBe(201);

    // O "segundo SELECT" (comentário no resultController) já devolve o place
    // calculado dentro da própria resposta do POST, sem precisar de outra chamada.
    expect(c.body.data.place).toBe(1);

    const ranking = await request(app).get(
      `/api/results?workout_id=${workoutId}&category_id=${categoryId}`
    );
    const placePorNome = {};
    ranking.body.data.forEach((r) => {
      placePorNome[r.team_name] = r.place;
    });

    expect(placePorNome['Equipe C']).toBe(1);
    expect(placePorNome['Equipe A']).toBe(2);
    expect(placePorNome['Equipe B']).toBe(2);
    expect(placePorNome['Equipe D']).toBe(4); // RANK pula o 3, não vira ROW_NUMBER
  });

  test('rejeita lançamento duplicado na mesma bateria (409)', async () => {
    const res = await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id: heatTeamIdByName['Equipe A'], raw_value: 999 });

    expect(res.status).toBe(409);
  });

  test('rejeita raw_value e did_not_finish informados juntos (400)', async () => {
    const res = await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id: heatTeamIdByName['Equipe B'], raw_value: 500, did_not_finish: true });

    expect(res.status).toBe(400);
  });

  test('rejeita heat_team_id inexistente (404)', async () => {
    const res = await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id: 999999999, raw_value: 500 });

    expect(res.status).toBe(404);
  });

  test('UPDATE recalcula o ranking: corrigir DNF para 400s vira 1º lugar sozinho', async () => {
    const atual = await request(app).get(
      `/api/results?workout_id=${workoutId}&category_id=${categoryId}`
    );
    const resultadoD = atual.body.data.find((r) => r.team_name === 'Equipe D');

    const update = await request(app)
      .put(`/api/results/${resultadoD.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ raw_value: 400, did_not_finish: false });

    expect(update.status).toBe(200);

    const ranking = await request(app).get(
      `/api/results?workout_id=${workoutId}&category_id=${categoryId}`
    );
    const placePorNome = {};
    ranking.body.data.forEach((r) => {
      placePorNome[r.team_name] = r.place;
    });

    expect(placePorNome['Equipe D']).toBe(1);
    expect(placePorNome['Equipe C']).toBe(2);
  });

  test('DELETE recalcula o ranking sem deixar buraco na numeração', async () => {
    const atual = await request(app).get(
      `/api/results?workout_id=${workoutId}&category_id=${categoryId}`
    );
    const resultadoC = atual.body.data.find((r) => r.team_name === 'Equipe C');

    const del = await request(app)
      .delete(`/api/results/${resultadoC.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(del.status).toBe(200);

    const ranking = await request(app).get(
      `/api/results?workout_id=${workoutId}&category_id=${categoryId}`
    );
    expect(ranking.body.data).toHaveLength(3);

    const placePorNome = {};
    ranking.body.data.forEach((r) => {
      placePorNome[r.team_name] = r.place;
    });
    expect(placePorNome['Equipe D']).toBe(1);
    expect(placePorNome['Equipe A']).toBe(2);
    expect(placePorNome['Equipe B']).toBe(2);
  });
});
