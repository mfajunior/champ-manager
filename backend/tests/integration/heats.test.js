const request = require('supertest');
const app = require('../../src/app');
const { pool } = require('../../src/config/database');

/**
 * A geração de baterias é o endpoint mais arriscado do backend: roda dentro
 * de uma transação, apaga heats existentes antes de recriar, e tem uma trava
 * (force: true) contra apagar resultados já lançados sem querer. Nenhum
 * desses três comportamentos tinha teste de integração dedicado — só eram
 * exercitados de raspão no `beforeAll` de outros arquivos (leaderboard,
 * websocket), sem nenhuma asserção sobre a geração em si.
 *
 * O que mais importa validar contra banco real: a distribuição BALANCEADA
 * (round-robin), não "encher até o limite" — 6 equipes em raias de 4 tem que
 * virar 2 baterias de 3, nunca uma de 4 e outra de 2.
 */
describe('Heats — geração de baterias (integração com banco real)', () => {
  let token;
  let championshipId;
  let categoriaComEquipes;
  let categoriaVazia;
  let categoriaDeOutroChampionship;
  let workoutId;

  beforeAll(async () => {
    const email = `jest-heats-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    const registro = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'jest12345', name: 'Jest Heats' });
    token = registro.body.data.token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest Heats Championship', date: '2026-11-25', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;
    categoriaComEquipes = campeonato.body.data.categories[0].id;
    categoriaVazia = campeonato.body.data.categories[1].id;

    // 6 equipes na mesma categoria — o número que expõe a diferença entre
    // "balanceado" (3+3) e "encher até o limite" (4+2) com 4 raias por bateria.
    for (let i = 1; i <= 6; i += 1) {
      await request(app)
        .post('/api/teams')
        .set('Authorization', `Bearer ${token}`)
        .send({
          championship_id: championshipId,
          category_id: categoriaComEquipes,
          name: `Equipe ${i}`,
        });
    }

    const workout = await request(app)
      .post('/api/workouts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        championship_id: championshipId,
        workout_number: 1,
        name: 'WOD Heats',
        scoring_type: 'time',
      });
    workoutId = workout.body.data.id;

    const outro = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest Outro (heats)', date: '2026-11-26', location: 'Box X' });
    categoriaDeOutroChampionship = outro.body.data.categories[0].id;
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('POST .../heats sem lanes_per_heat é rejeitado (400)', async () => {
    const res = await request(app)
      .post(`/api/workouts/${workoutId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category_id: categoriaComEquipes });

    expect(res.status).toBe(400);
  });

  test('workout_id inexistente devolve 404', async () => {
    const res = await request(app)
      .post('/api/workouts/999999999/heats')
      .set('Authorization', `Bearer ${token}`)
      .send({ category_id: categoriaComEquipes, lanes_per_heat: 4 });

    expect(res.status).toBe(404);
  });

  test('category_id que não pertence ao campeonato da prova é rejeitada (400)', async () => {
    const res = await request(app)
      .post(`/api/workouts/${workoutId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category_id: categoriaDeOutroChampionship, lanes_per_heat: 4 });

    expect(res.status).toBe(400);
  });

  test('categoria sem nenhuma equipe registrada é rejeitada (400)', async () => {
    const res = await request(app)
      .post(`/api/workouts/${workoutId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category_id: categoriaVazia, lanes_per_heat: 4 });

    expect(res.status).toBe(400);
  });

  test('6 equipes em raias de 4 vira 2 baterias de 3 — balanceado, não 4+2', async () => {
    const res = await request(app)
      .post(`/api/workouts/${workoutId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category_id: categoriaComEquipes, lanes_per_heat: 4 });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(2);

    const tamanhos = res.body.data.map((h) => h.lanes_used).sort();
    expect(tamanhos).toEqual([3, 3]);

    // O oposto do que queremos: nenhuma bateria pode ficar com todas as 4
    // raias ocupadas enquanto a outra fica pela metade.
    expect(res.body.data.every((h) => h.lanes_empty === 1)).toBe(true);
  });

  test('GET .../heats devolve as baterias com as equipes em cada raia', async () => {
    const res = await request(app).get(`/api/workouts/${workoutId}/heats?category_id=${categoriaComEquipes}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const totalEquipesListadas = res.body.data.reduce((soma, h) => soma + h.teams.length, 0);
    expect(totalEquipesListadas).toBe(6);
  });

  test('regenerar baterias com resultado já lançado é rejeitado sem force (409)', async () => {
    const heats = await request(app).get(
      `/api/workouts/${workoutId}/heats?category_id=${categoriaComEquipes}`
    );
    const heatTeamId = heats.body.data[0].teams[0].heat_team_id;

    await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id: heatTeamId, raw_value: 300 });

    const res = await request(app)
      .post(`/api/workouts/${workoutId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category_id: categoriaComEquipes, lanes_per_heat: 4 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESULTS_EXIST');
  });

  test('regenerar com force: true apaga as baterias antigas (e os resultados, por CASCADE)', async () => {
    const antesDaRegeracao = await pool.query(
      `SELECT COUNT(r.id)::int AS total
       FROM results r
       JOIN heat_teams ht ON ht.id = r.heat_team_id
       JOIN heats h ON h.id = ht.heat_id
       WHERE h.workout_id = $1 AND h.category_id = $2`,
      [workoutId, categoriaComEquipes]
    );
    expect(antesDaRegeracao.rows[0].total).toBeGreaterThan(0);

    const res = await request(app)
      .post(`/api/workouts/${workoutId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category_id: categoriaComEquipes, lanes_per_heat: 3, force: true });

    expect(res.status).toBe(201);
    expect(res.body.meta.replacedExistingResults).toBe(true);
    // 6 equipes / 3 raias por bateria = 2 baterias novas, cheias desta vez
    // (6 é múltiplo exato de 3 — não há raia vaga para sobrar).
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((h) => h.lanes_used === 3)).toBe(true);

    const depoisDaRegeracao = await pool.query(
      `SELECT COUNT(r.id)::int AS total
       FROM results r
       JOIN heat_teams ht ON ht.id = r.heat_team_id
       JOIN heats h ON h.id = ht.heat_id
       WHERE h.workout_id = $1 AND h.category_id = $2`,
      [workoutId, categoriaComEquipes]
    );
    expect(depoisDaRegeracao.rows[0].total).toBe(0);
  });

  test('PUT /api/heats/:id atualiza o status da bateria', async () => {
    const heats = await request(app).get(
      `/api/workouts/${workoutId}/heats?category_id=${categoriaComEquipes}`
    );
    const heatId = heats.body.data[0].id;

    const res = await request(app)
      .put(`/api/heats/${heatId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'in_progress' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('in_progress');
  });

  test('PUT /api/heats/:id com status inválido é rejeitado (400)', async () => {
    const heats = await request(app).get(
      `/api/workouts/${workoutId}/heats?category_id=${categoriaComEquipes}`
    );
    const heatId = heats.body.data[0].id;

    const res = await request(app)
      .put(`/api/heats/${heatId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'finalizado' }); // não existe esse status

    expect(res.status).toBe(400);
  });

  test('PUT /api/heats/:id com corpo vazio é rejeitado (400)', async () => {
    const heats = await request(app).get(
      `/api/workouts/${workoutId}/heats?category_id=${categoriaComEquipes}`
    );
    const heatId = heats.body.data[0].id;

    const res = await request(app)
      .put(`/api/heats/${heatId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });
});
