const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * A geração de baterias é o endpoint mais arriscado do backend: roda dentro
 * de uma transação, apaga heats existentes antes de recriar, e tem uma trava
 * (force: true) contra apagar resultados já lançados sem querer.
 *
 * Desde a migration 005, raias/transição/início de agenda são parâmetros
 * GLOBAIS do campeonato (não mais por chamada), e uma bateria pode misturar
 * categorias diferentes — o que sobra de uma categoria é completado pela
 * próxima da sequência fixa (nível: iniciante -> scale -> rx; dentro do
 * nível: feminino -> masculino -> misto), em vez de deixar raia vazia.
 */
describe('Heats — geração de baterias (integração com banco real)', () => {
  let token;
  let championshipId;
  let categoriaIniciante; // Iniciante Masculino (índice 0 nas categorias padrão)
  let categoriaInicianteFem; // Iniciante Feminino (índice 1)
  let categoriaVazia; // Scale Masculino (índice 2) — sem equipe nenhuma
  let workoutId;

  beforeAll(async () => {
    const email = `jest-heats-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest Heats' })).token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest Heats Championship', date: '2026-11-25', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;
    categoriaIniciante = campeonato.body.data.categories[0].id; // Iniciante Masculino
    categoriaInicianteFem = campeonato.body.data.categories[1].id; // Iniciante Feminino
    categoriaVazia = campeonato.body.data.categories[2].id; // Scale Masculino

    // 6 equipes em Iniciante Masculino — número que, sozinho, já preencheria
    // 1 bateria e meia com lanes_per_heat=4 (4 + 2), sobrando 2 raias pra
    // completar com a próxima categoria da sequência.
    for (let i = 1; i <= 6; i += 1) {
      await request(app)
        .post('/api/teams')
        .set('Authorization', `Bearer ${token}`)
        .send({
          championship_id: championshipId,
          category_id: categoriaIniciante,
          name: `Equipe IM ${i}`,
        });
    }

    // 2 equipes em Iniciante Feminino, categoria seguinte na sequência (nível
    // igual, gênero antes de masculino... na verdade feminino vem ANTES de
    // masculino — ver LEVEL_ORDER/GENDER_ORDER em heatController). Registradas
    // mesmo assim: o que importa aqui é ter mais de uma categoria com equipe
    // pra exercitar a mistura, não a ordem exata neste teste.
    for (let i = 1; i <= 2; i += 1) {
      await request(app)
        .post('/api/teams')
        .set('Authorization', `Bearer ${token}`)
        .send({
          championship_id: championshipId,
          category_id: categoriaInicianteFem,
          name: `Equipe IF ${i}`,
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
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('POST .../heats sem lanes_per_heat definido no campeonato é rejeitado (400)', async () => {
    const res = await request(app)
      .post(`/api/workouts/${workoutId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('workout_id inexistente devolve 404', async () => {
    const res = await request(app)
      .post('/api/workouts/999999999/heats')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(404);
  });

  test('define lanes_per_heat/transição/início no campeonato (PUT /api/championships/:id)', async () => {
    const res = await request(app)
      .put(`/api/championships/${championshipId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lanes_per_heat: 4, transition_seconds: 60, start_time: '08:00' });

    expect(res.status).toBe(200);
    expect(res.body.data.lanes_per_heat).toBe(4);
    expect(res.body.data.transition_seconds).toBe(60);
    expect(res.body.data.start_time).toBe('08:00:00');
  });

  test('categoria vazia (Scale Masculino, sem equipe) não bloqueia a geração — ela só não participa', async () => {
    // Com lanes_per_heat já definido e ao menos uma categoria (Iniciante
    // Masculino/Feminino) tendo equipe, a prova gera normalmente; a
    // categoria vazia simplesmente não aparece em categoriesIncluded.
    const res = await request(app)
      .post(`/api/workouts/${workoutId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
    const idsIncluidos = res.body.meta.categoriesIncluded.map((c) => c.id);
    expect(idsIncluidos).not.toContain(categoriaVazia);
  });

  test('8 equipes (6 Iniciante Masc + 2 Iniciante Fem) em raias de 4 vira 2 baterias, misturando categorias na sobra', async () => {
    const res = await request(app)
      .post(`/api/workouts/${workoutId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.totalTeams).toBe(8);
    expect(res.body.meta.lanesPerHeat).toBe(4);

    // Nenhuma bateria fica com raia vazia: 8 equipes / 4 raias = exatamente 2
    // baterias cheias, já que a segunda categoria completa a sobra da primeira.
    expect(res.body.data.every((h) => h.lanes_used === 4)).toBe(true);

    // A mistura de categorias só pode acontecer na bateria de fronteira — a
    // que contém equipes de mais de uma categoria.
    const categoriasPorBateria = res.body.data.map(
      (h) => new Set(h.teams.map((t) => t.category_id)).size
    );
    expect(categoriasPorBateria.some((n) => n > 1)).toBe(true);

    // Esta prova não tem time cap definido em workout_variants pra nenhuma
    // categoria (não é o foco deste teste) — então só a PRIMEIRA bateria
    // recebe horário, a partir do start_time do campeonato: sem duração
    // conhecida, não dá pra calcular quando ela termina, então a bateria
    // seguinte fica sem horário. O teste de propagação de null com time cap
    // definido está em tests/unit/heatController.test.js
    // (computeHeatSchedule).
    expect(res.body.data[0].scheduled_time).not.toBeNull();
    expect(res.body.data[1].scheduled_time).toBeNull();
  });

  test('GET .../heats devolve as baterias com a categoria de cada equipe por raia', async () => {
    const res = await request(app).get(`/api/workouts/${workoutId}/heats`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const totalEquipesListadas = res.body.data.reduce((soma, h) => soma + h.teams.length, 0);
    expect(totalEquipesListadas).toBe(8);
    // Cada raia carrega a categoria da própria equipe, não da bateria.
    expect(res.body.data[0].teams[0]).toHaveProperty('category_id');
  });

  test('regenerar baterias com resultado já lançado é rejeitado sem force (409)', async () => {
    const heats = await request(app).get(`/api/workouts/${workoutId}/heats`);
    const heatTeamId = heats.body.data[0].teams[0].heat_team_id;

    await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id: heatTeamId, raw_value: 300 });

    const res = await request(app)
      .post(`/api/workouts/${workoutId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESULTS_EXIST');
  });

  test('regenerar com force: true apaga as baterias antigas (e os resultados, por CASCADE)', async () => {
    const antesDaRegeracao = await pool.query(
      `SELECT COUNT(r.id)::int AS total
       FROM results r
       JOIN heat_teams ht ON ht.id = r.heat_team_id
       JOIN heats h ON h.id = ht.heat_id
       WHERE h.workout_id = $1`,
      [workoutId]
    );
    expect(antesDaRegeracao.rows[0].total).toBeGreaterThan(0);

    const res = await request(app)
      .post(`/api/workouts/${workoutId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({ force: true });

    expect(res.status).toBe(201);
    expect(res.body.meta.replacedExistingResults).toBe(true);

    const depoisDaRegeracao = await pool.query(
      `SELECT COUNT(r.id)::int AS total
       FROM results r
       JOIN heat_teams ht ON ht.id = r.heat_team_id
       JOIN heats h ON h.id = ht.heat_id
       WHERE h.workout_id = $1`,
      [workoutId]
    );
    expect(depoisDaRegeracao.rows[0].total).toBe(0);
  });

  test('PUT /api/heats/:id atualiza o status da bateria', async () => {
    const heats = await request(app).get(`/api/workouts/${workoutId}/heats`);
    const heatId = heats.body.data[0].id;

    const res = await request(app)
      .put(`/api/heats/${heatId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'in_progress' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('in_progress');
  });

  test('PUT /api/heats/:id com status inválido é rejeitado (400)', async () => {
    const heats = await request(app).get(`/api/workouts/${workoutId}/heats`);
    const heatId = heats.body.data[0].id;

    const res = await request(app)
      .put(`/api/heats/${heatId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'finalizado' }); // não existe esse status

    expect(res.status).toBe(400);
  });

  test('PUT /api/heats/:id com corpo vazio é rejeitado (400)', async () => {
    const heats = await request(app).get(`/api/workouts/${workoutId}/heats`);
    const heatId = heats.body.data[0].id;

    const res = await request(app)
      .put(`/api/heats/${heatId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });
});
