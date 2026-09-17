const request = require('supertest');
const app = require('../../src/app');
const { pool } = require('../../src/config/database');

/**
 * scoring_type é o campo que decide como recalculate_placements (migration
 * 003) vai ordenar os resultados dessa prova — o bug real que já aconteceu
 * neste projeto foi toda prova nascer com o default do banco porque o create
 * nem aceitava o campo. Esse é o comportamento que mais vale testar aqui,
 * não o CRUD básico.
 */
describe('Workouts (integração com banco real)', () => {
  let token;
  let championshipId;

  beforeAll(async () => {
    const email = `jest-workouts-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    const registro = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'jest12345', name: 'Jest Workouts' });
    token = registro.body.data.token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest Workouts Championship', date: '2026-11-10', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('POST / sem scoring_type usa o default "time"', async () => {
    const res = await request(app)
      .post('/api/workouts')
      .set('Authorization', `Bearer ${token}`)
      .send({ championship_id: championshipId, workout_number: 1, name: 'WOD 1' });

    expect(res.status).toBe(201);
    expect(res.body.data.scoring_type).toBe('time');
  });

  test('POST / com scoring_type "reps" persiste o valor informado', async () => {
    const res = await request(app)
      .post('/api/workouts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        championship_id: championshipId,
        workout_number: 2,
        name: 'WOD 2 — AMRAP',
        scoring_type: 'reps',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.scoring_type).toBe('reps');
  });

  test('POST / com scoring_type inválido é rejeitado pelo Joi, nem chega no banco (400)', async () => {
    const res = await request(app)
      .post('/api/workouts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        championship_id: championshipId,
        workout_number: 3,
        name: 'WOD Inválido',
        scoring_type: 'pontos', // não existe esse scoring_type
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('POST / com workout_number repetido no mesmo campeonato é rejeitado (409)', async () => {
    const res = await request(app)
      .post('/api/workouts')
      .set('Authorization', `Bearer ${token}`)
      .send({ championship_id: championshipId, workout_number: 1, name: 'WOD 1 Duplicado' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  test('GET / sem championship_id é rejeitado (400)', async () => {
    const res = await request(app).get('/api/workouts');
    expect(res.status).toBe(400);
  });

  test('GET /?championship_id lista as provas criadas', async () => {
    const res = await request(app).get(`/api/workouts?championship_id=${championshipId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((w) => w.workout_number).sort()).toEqual([1, 2]);
  });

  test('GET /:id inexistente devolve 404', async () => {
    const res = await request(app).get('/api/workouts/999999999');
    expect(res.status).toBe(404);
  });

  test('PUT /:id atualiza o nome sem exigir os outros campos', async () => {
    const lista = await request(app).get(`/api/workouts?championship_id=${championshipId}`);
    const workoutId = lista.body.data.find((w) => w.workout_number === 1).id;

    const res = await request(app)
      .put(`/api/workouts/${workoutId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'WOD 1 — Renomeado' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('WOD 1 — Renomeado');
    expect(res.body.data.scoring_type).toBe('time'); // não mudou
  });

  test('PUT /:id com scoring_type inválido é rejeitado pelo Joi (400)', async () => {
    const lista = await request(app).get(`/api/workouts?championship_id=${championshipId}`);
    const workoutId = lista.body.data[0].id;

    const res = await request(app)
      .put(`/api/workouts/${workoutId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scoring_type: 'pontos' });

    expect(res.status).toBe(400);
  });

  test('PUT /:id avisa (mas não bloqueia) trocar scoring_type de prova com resultado já lançado', async () => {
    const lista = await request(app).get(`/api/workouts?championship_id=${championshipId}`);
    const workoutId = lista.body.data.find((w) => w.workout_number === 1).id;

    const championship = await request(app).get(`/api/championships/${championshipId}`);
    const categoryId = championship.body.data.categories[0].id;

    await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ championship_id: championshipId, category_id: categoryId, name: 'Equipe Warning' });

    await request(app)
      .post(`/api/workouts/${workoutId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category_id: categoryId, lanes_per_heat: 4 });

    const heats = await request(app).get(`/api/workouts/${workoutId}/heats?category_id=${categoryId}`);
    const heatTeamId = heats.body.data[0].teams[0].heat_team_id;

    await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id: heatTeamId, raw_value: 300 });

    // Troca de 'time' pra 'reps' numa prova que já tem 1 resultado lançado
    // com esse scoring_type: a troca é aceita (o organizador pode estar
    // corrigindo um cadastro), mas vem com aviso — o ranking desse resultado
    // só será recalculado com a regra nova quando ele for corrigido de novo.
    const res = await request(app)
      .put(`/api/workouts/${workoutId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scoring_type: 'reps' });

    expect(res.status).toBe(200);
    expect(res.body.data.scoring_type).toBe('reps');
    expect(res.body.meta.warning).toBeDefined();
    expect(res.body.meta.warning).toMatch(/1 resultado/);
  });

  test('PUT variante cria a descrição por categoria e é idempotente (upsert)', async () => {
    const lista = await request(app).get(`/api/workouts?championship_id=${championshipId}`);
    const workoutId = lista.body.data.find((w) => w.workout_number === 2).id;

    const championship = await request(app).get(`/api/championships/${championshipId}`);
    const categoryId = championship.body.data.categories[0].id;

    const primeira = await request(app)
      .put(`/api/workouts/${workoutId}/variants/${categoryId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: '15 min AMRAP: 10 burpees, 10 box jumps', time_cap_seconds: 900 });

    expect(primeira.status).toBe(200);

    // Chamar de novo com descrição diferente atualiza a mesma linha (ON CONFLICT),
    // não cria uma segunda variante para o mesmo par (workout, categoria).
    const segunda = await request(app)
      .put(`/api/workouts/${workoutId}/variants/${categoryId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: '15 min AMRAP: 8 burpees, 8 box jumps (escalado)' });

    expect(segunda.status).toBe(200);
    expect(segunda.body.data.id).toBe(primeira.body.data.id);

    const detalhe = await request(app).get(`/api/workouts/${workoutId}`);
    const variantesDaCategoria = detalhe.body.data.variants.filter(
      (v) => v.category_id === categoryId
    );
    expect(variantesDaCategoria).toHaveLength(1);
    expect(variantesDaCategoria[0].description).toContain('escalado');
  });

  test('DELETE /:workout_id/variants/:category_id remove a variante', async () => {
    const lista = await request(app).get(`/api/workouts?championship_id=${championshipId}`);
    const workoutId = lista.body.data.find((w) => w.workout_number === 2).id;
    const championship = await request(app).get(`/api/championships/${championshipId}`);
    const categoryId = championship.body.data.categories[0].id;

    const del = await request(app)
      .delete(`/api/workouts/${workoutId}/variants/${categoryId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const detalhe = await request(app).get(`/api/workouts/${workoutId}`);
    expect(detalhe.body.data.variants.find((v) => v.category_id === categoryId)).toBeUndefined();
  });

  test('DELETE /:id remove a prova por CASCADE', async () => {
    const lista = await request(app).get(`/api/workouts?championship_id=${championshipId}`);
    const workoutId = lista.body.data.find((w) => w.workout_number === 2).id;

    const del = await request(app)
      .delete(`/api/workouts/${workoutId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const getDepois = await request(app).get(`/api/workouts/${workoutId}`);
    expect(getDepois.status).toBe(404);
  });
});
