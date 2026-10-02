const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * Troca do modelo de pontuação e corte por prova, pela API.
 *
 * O teste mais importante aqui é o do 409: trocar o modelo com resultados
 * lançados inverte o placar de cabeça para baixo (menor soma de colocações
 * liderava, passa a liderar a maior soma de pontos). Se isso acontecer sem
 * confirmação explícita, o organizador vê o pódio mudar sozinho.
 */
describe('API do modelo de pontuação e dos cortes', () => {
  let token;
  let championshipId;
  let categoriaId;
  let provaUmId;
  let provaDoisId;
  let tabelaId;
  const equipes = {};
  const auth = () => ({ Authorization: `Bearer ${token}` });

  const placar = async () => {
    const res = await request(app).get(`/api/leaderboard?championship_id=${championshipId}`);
    return Object.fromEntries(res.body.data.map((l) => [l.team_name, l]));
  };

  beforeAll(async () => {
    const email = `jest-sm-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest SM' })).token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set(auth())
      .send({ name: 'Jest Scoring Model', date: '2026-12-09', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;
    categoriaId = campeonato.body.data.categories[0].id;

    await request(app)
      .put(`/api/championships/${championshipId}`)
      .set(auth())
      .send({ lanes_per_heat: 5 });

    for (const nome of ['T1', 'T2', 'T3', 'T4', 'T5']) {
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
          name: `WOD SM ${numero}`,
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
        ranges: [
          { start_place: 1, end_place: 3, decrement: 5 },
          { start_place: 4, end_place: 7, decrement: 3 },
          { start_place: 8, end_place: null, decrement: 2 },
        ],
      });
    tabelaId = tabela.body.data.id;

    // Prova 1 lançada: T1 vence, T5 é a última.
    await request(app)
      .post(`/api/workouts/${provaUmId}/heats`)
      .set(auth())
      .send({});
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

  describe('troca do modelo', () => {
    test('ligar o modelo novo sem escolher tabela é recusado com mensagem útil', async () => {
      const res = await request(app)
        .put(`/api/championships/${championshipId}/scoring-model`)
        .set(auth())
        .send({ scoring_model: 'points_table', confirm: true });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/tabela de pontos/i);
    });

    test('com resultados lançados e sem confirm, devolve 409 dizendo quantos', async () => {
      const res = await request(app)
        .put(`/api/championships/${championshipId}/scoring-model`)
        .set(auth())
        .send({ scoring_model: 'points_table', points_table_id: tabelaId });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RESULTS_EXIST');
      expect(res.body.error.message).toMatch(/5 resultado/);
      // E não mudou nada:
      const p = await placar();
      expect(p.T1.scoring_model).toBe('legacy');
    });

    test('com confirm, troca e o placar passa a ser por pontos', async () => {
      const res = await request(app)
        .put(`/api/championships/${championshipId}/scoring-model`)
        .set(auth())
        .send({ scoring_model: 'points_table', points_table_id: tabelaId, confirm: true });

      expect(res.status).toBe(200);
      expect(res.body.meta.recalculated_results).toBe(5);

      const p = await placar();
      expect(p.T1.scoring_model).toBe('points_table');
      expect(p.T1.total_points).toBe(100);
      expect(p.T4.total_points).toBe(87);
      expect(p.T1.place).toBe(1);
      // O campo antigo continua significando o que sempre significou.
      expect(p.T1.total_score).toBe(1);
    });

    test('voltar para legacy devolve o placar ao formato antigo', async () => {
      const res = await request(app)
        .put(`/api/championships/${championshipId}/scoring-model`)
        .set(auth())
        .send({ scoring_model: 'legacy', confirm: true });

      expect(res.status).toBe(200);
      const p = await placar();
      expect(p.T1.scoring_model).toBe('legacy');
      expect(p.T1.total_points).toBeNull(); // pontos não se aplicam no legacy
      expect(p.T1.place).toBe(1);

      // devolve ao modelo novo para os testes de corte
      await request(app)
        .put(`/api/championships/${championshipId}/scoring-model`)
        .set(auth())
        .send({ scoring_model: 'points_table', points_table_id: tabelaId, confirm: true });
    });
  });

  describe('corte por prova', () => {
    test('antes de configurar, todas disputam e nada está desatualizado', async () => {
      // Baterias da prova 2 geradas ANTES do corte existir — é o cenário real
      // de quem monta o dia todo de manhã e decide o corte depois.
      await request(app)
        .post(`/api/workouts/${provaDoisId}/heats`)
        .set(auth())
        .send({});

      const res = await request(app).get(`/api/workouts/${provaDoisId}/eligible-teams`);
      const rx = res.body.data.find((c) => c.category_id === categoriaId);

      expect(rx.keep_top_n).toBeNull();
      expect(rx.eligible).toHaveLength(5);
      expect(rx.outdated).toBe(false);
      expect(res.body.meta.any_outdated).toBe(false);
    });

    test('configurar o corte marca quem ficou fora, sem apagar os pontos', async () => {
      const res = await request(app)
        .put(`/api/workouts/${provaDoisId}/cut`)
        .set(auth())
        .send({ keep_top_n: 3 });

      expect(res.status).toBe(200);

      const p = await placar();
      expect(p.T1.is_cut).toBe(false);
      expect(p.T4.is_cut).toBe(true);
      expect(p.T5.is_cut).toBe(true);
      expect(p.T4.total_points).toBe(87); // mantém o que conquistou
      expect(p.T4.place).toBe(4); // e cai para depois de quem continua
    });

    test('as baterias já geradas passam a divergir, e a API avisa', async () => {
      const res = await request(app).get(`/api/workouts/${provaDoisId}/eligible-teams`);
      const rx = res.body.data.find((c) => c.category_id === categoriaId);

      expect(rx.keep_top_n).toBe(3);
      expect(rx.eligible.map((e) => e.team_name)).toEqual(['T1', 'T2', 'T3']);
      expect(rx.scheduled).toHaveLength(5); // geradas antes do corte
      expect(rx.outdated).toBe(true);
      expect(res.body.meta.any_outdated).toBe(true);
    });

    test('categoria de outro campeonato é recusada', async () => {
      const outro = await request(app)
        .post('/api/championships')
        .set(auth())
        .send({ name: 'Jest SM Outro', date: '2026-12-10', location: 'Box Jest' });

      const res = await request(app)
        .put(`/api/workouts/${provaDoisId}/cut`)
        .set(auth())
        .send({ keep_top_n: 2, category_id: outro.body.data.categories[0].id });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/não pertence/);

      await request(app)
        .delete(`/api/championships/${outro.body.data.id}`)
        .set(auth());
    });

    test('remover o corte traz todo mundo de volta', async () => {
      const res = await request(app)
        .delete(`/api/workouts/${provaDoisId}/cut`)
        .set(auth());

      expect(res.status).toBe(200);

      const p = await placar();
      expect(p.T4.is_cut).toBe(false);
      expect(p.T5.is_cut).toBe(false);

      const elegiveis = await request(app).get(`/api/workouts/${provaDoisId}/eligible-teams`);
      expect(elegiveis.body.data.find((c) => c.category_id === categoriaId).eligible).toHaveLength(5);
    });

    test('remover corte que não existe é 404, não silêncio', async () => {
      const res = await request(app)
        .delete(`/api/workouts/${provaDoisId}/cut`)
        .set(auth());
      expect(res.status).toBe(404);
    });
  });
});
