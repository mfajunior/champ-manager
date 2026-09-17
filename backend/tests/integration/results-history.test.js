const request = require('supertest');
const app = require('../../src/app');
const { pool } = require('../../src/config/database');

/**
 * A coluna results.recorded_by existe desde a migration 001, mas só guarda
 * quem CRIOU o resultado — uma correção (UPDATE) nunca atualizava esse campo,
 * e não existia nenhum endpoint pra consultar sequer esse dado. A migration
 * 004 (result_audit_log) resolve as duas coisas: uma linha por ação
 * (created/updated/deleted), sempre com quem fez.
 *
 * A consulta é por heat_team_id, não por result_id, de propósito: a raia
 * continua existindo mesmo depois que o resultado dela é apagado, então é a
 * chave estável pra "me mostra o histórico disso" com ou sem resultado ativo.
 */
describe('Histórico de auditoria de resultados (integração com banco real)', () => {
  let token;
  let championshipId;
  let heatTeamId;

  beforeAll(async () => {
    const email = `jest-history-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    const registro = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'jest12345', name: 'Jest History' });
    token = registro.body.data.token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest History Championship', date: '2026-12-05', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;
    const categoryId = campeonato.body.data.categories[0].id;

    await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ championship_id: championshipId, category_id: categoryId, name: 'Equipe History' });

    const workout = await request(app)
      .post('/api/workouts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        championship_id: championshipId,
        workout_number: 1,
        name: 'WOD History',
        scoring_type: 'time',
      });

    await request(app)
      .post(`/api/workouts/${workout.body.data.id}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category_id: categoryId, lanes_per_heat: 4 });

    const heats = await request(app).get(`/api/workouts/${workout.body.data.id}/heats`);
    heatTeamId = heats.body.data[0].teams[0].heat_team_id;
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('GET .../history sem token é rejeitado (401)', async () => {
    const res = await request(app).get(`/api/results/heat-teams/${heatTeamId}/history`);
    expect(res.status).toBe(401);
  });

  test('heat_team_id inexistente devolve 404', async () => {
    const res = await request(app)
      .get('/api/results/heat-teams/999999999/history')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test('antes de qualquer resultado, o histórico vem vazio (não é erro)', async () => {
    const res = await request(app)
      .get(`/api/results/heat-teams/${heatTeamId}/history`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('criar um resultado grava uma entrada "created" com quem fez', async () => {
    await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id: heatTeamId, raw_value: 300 });

    const res = await request(app)
      .get(`/api/results/heat-teams/${heatTeamId}/history`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].action).toBe('created');
    expect(Number(res.body.data[0].raw_value)).toBe(300);
    expect(res.body.data[0].changed_by_name).toBe('Jest History');
  });

  test('corrigir o resultado ADICIONA uma entrada "updated" — não substitui a "created"', async () => {
    const antes = await request(app)
      .get(`/api/results/heat-teams/${heatTeamId}/history`)
      .set('Authorization', `Bearer ${token}`);
    const resultId =
      antes.body.data.find((h) => h.action === 'created').result_id;

    await request(app)
      .put(`/api/results/${resultId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ raw_value: 280 });

    const res = await request(app)
      .get(`/api/results/heat-teams/${heatTeamId}/history`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((h) => h.action)).toEqual(['created', 'updated']);
    expect(Number(res.body.data[1].raw_value)).toBe(280);
  });

  test('apagar o resultado registra "deleted" e preserva o histórico anterior', async () => {
    const antes = await request(app)
      .get(`/api/results/heat-teams/${heatTeamId}/history`)
      .set('Authorization', `Bearer ${token}`);
    const resultId = antes.body.data.find((h) => h.action === 'updated').result_id;

    await request(app)
      .delete(`/api/results/${resultId}`)
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .get(`/api/results/heat-teams/${heatTeamId}/history`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data).toHaveLength(3);
    expect(res.body.data.map((h) => h.action)).toEqual(['created', 'updated', 'deleted']);

    const entradaApagada = res.body.data[2];
    expect(Number(entradaApagada.raw_value)).toBe(280); // valor de antes de apagar
    // O resultado em si não existe mais — result_id foi zerado automaticamente
    // pela FK ON DELETE SET NULL — mas a linha do log (e o valor histórico) continua.
    expect(entradaApagada.result_id).toBeNull();

    const resultadoNoBanco = await pool.query('SELECT id FROM results WHERE id = $1', [resultId]);
    expect(resultadoNoBanco.rows).toHaveLength(0);
  });
});
