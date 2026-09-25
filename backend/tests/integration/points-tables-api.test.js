const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * Endpoints das tabelas de pontos.
 *
 * O foco aqui é a FRONTEIRA: se a regra que mora no banco chega ao cliente
 * como HTTP decente. As mensagens de validação são escritas pela constraint
 * trigger (migration 012) e só traduzidas pelo controller — se este arquivo
 * passar, quer dizer que o erro do Postgres virou 400 com texto legível em vez
 * de 500 com SQLSTATE, que é o que aconteceria sem tratamento.
 */
describe('API das tabelas de pontos', () => {
  let token;
  let championshipId;
  let categoriaId;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  const criarTabela = (body) =>
    request(app)
      .post(`/api/championships/${championshipId}/points-tables`)
      .set(auth())
      .send(body);

  beforeAll(async () => {
    const email = `jest-pt-api-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest PT API' })).token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set(auth())
      .send({ name: 'Jest PT API Championship', date: '2026-12-08', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;
    categoriaId = campeonato.body.data.categories[0].id;

    for (const nome of ['E1', 'E2', 'E3', 'E4', 'E5']) {
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post('/api/teams')
        .set(auth())
        .send({ championship_id: championshipId, category_id: categoriaId, name: nome });
    }
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query(
        'UPDATE championships SET scoring_model = $2, points_table_id = NULL WHERE id = $1',
        [championshipId, 'legacy']
      );
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  describe('criação', () => {
    test('cria a tabela com as faixas no mesmo corpo', async () => {
      const res = await criarTabela({
        name: 'Padrão',
        ranges: [
          { start_place: 1, end_place: 3, decrement: 5 },
          { start_place: 4, end_place: 7, decrement: 3 },
          { start_place: 8, end_place: null, decrement: 2 },
        ],
      });

      expect(res.status).toBe(201);
      expect(res.body.data.max_points).toBe(100); // default, não é campo de tela
      expect(res.body.data.ranges).toHaveLength(3);
      expect(res.body.data.ranges[2].end_place).toBeNull(); // a faixa aberta
    });

    test('sem token, recusa', async () => {
      const res = await request(app)
        .post(`/api/championships/${championshipId}/points-tables`)
        .send({ name: 'X', ranges: [{ start_place: 1, end_place: null, decrement: 1 }] });
      expect(res.status).toBe(401);
    });

    test('nome repetido no mesmo campeonato vira 409, não 500', async () => {
      const res = await criarTabela({
        name: 'Padrão',
        ranges: [{ start_place: 1, end_place: null, decrement: 4 }],
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    test('faixa que não começa na 1ª colocação vira 400 com a mensagem do banco', async () => {
      const res = await criarTabela({
        name: 'Começa torto',
        ranges: [{ start_place: 3, end_place: null, decrement: 5 }],
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/1ª colocação/);
    });

    test('buraco entre faixas vira 400', async () => {
      const res = await criarTabela({
        name: 'Com buraco',
        ranges: [
          { start_place: 1, end_place: 5, decrement: 5 },
          { start_place: 8, end_place: null, decrement: 2 },
        ],
      });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/buraco/);
    });

    test('última faixa fechada vira 400 — alguém ficaria sem pontuação', async () => {
      const res = await criarTabela({
        name: 'Sem faixa aberta',
        ranges: [
          { start_place: 1, end_place: 5, decrement: 5 },
          { start_place: 6, end_place: 10, decrement: 2 },
        ],
      });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/aberta/);
    });

    test('nada foi gravado pelas tentativas recusadas', async () => {
      const res = await request(app).get(`/api/championships/${championshipId}/points-tables`);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Padrão');
    });
  });

  describe('pré-visualização', () => {
    let tabelaId;

    beforeAll(async () => {
      const lista = await request(app).get(`/api/championships/${championshipId}/points-tables`);
      tabelaId = lista.body.data[0].id;
    });

    test('devolve a tabela colocação a colocação', async () => {
      const res = await request(app).get(
        `/api/championships/${championshipId}/points-tables/${tabelaId}/preview?places=12`
      );

      expect(res.status).toBe(200);
      const pontos = Object.fromEntries(res.body.data.places.map((p) => [p.place, p.points]));
      expect(pontos[1]).toBe(100);
      expect(pontos[3]).toBe(90);
      expect(pontos[4]).toBe(87); // virada de faixa: decremento da faixa nova
      expect(pontos[8]).toBe(76);
      expect(pontos[12]).toBe(68);
    });

    test('diz onde a pontuação zera e não avisa quando está longe', async () => {
      const res = await request(app).get(
        `/api/championships/${championshipId}/points-tables/${tabelaId}/preview`
      );
      expect(res.body.data.zeroes_at).toBe(46);
      expect(res.body.data.largest_category.teams).toBe(5);
      expect(res.body.meta.warning).toBeNull(); // 5 equipes, zera na 46ª
    });

    test('avisa quando a zeragem cai dentro da maior categoria', async () => {
      const ingreme = await criarTabela({
        name: 'Íngreme',
        ranges: [{ start_place: 1, end_place: null, decrement: 50 }],
      });
      const res = await request(app).get(
        `/api/championships/${championshipId}/points-tables/${ingreme.body.data.id}/preview`
      );

      expect(res.body.data.zeroes_at).toBe(3); // 100, 50, 0
      expect(res.body.meta.warning).toMatch(/3ª colocação/);
      expect(res.status).toBe(200); // informa, não bloqueia

      await request(app)
        .delete(
          `/api/championships/${championshipId}/points-tables/${ingreme.body.data.id}`
        )
        .set(auth());
    });
  });

  describe('atualização e exclusão', () => {
    let tabelaId;

    beforeAll(async () => {
      const lista = await request(app).get(`/api/championships/${championshipId}/points-tables`);
      tabelaId = lista.body.data.find((t) => t.name === 'Padrão').id;
    });

    test('mandar ranges substitui todas as faixas', async () => {
      const res = await request(app)
        .put(`/api/championships/${championshipId}/points-tables/${tabelaId}`)
        .set(auth())
        .send({ ranges: [{ start_place: 1, end_place: null, decrement: 4 }] });

      expect(res.status).toBe(200);
      expect(res.body.data.ranges).toHaveLength(1);

      const preview = await request(app).get(
        `/api/championships/${championshipId}/points-tables/${tabelaId}/preview?places=3`
      );
      expect(preview.body.data.places.map((p) => p.points)).toEqual([100, 96, 92]);
    });

    test('substituição inválida é recusada e não deixa a tabela sem faixas', async () => {
      const res = await request(app)
        .put(`/api/championships/${championshipId}/points-tables/${tabelaId}`)
        .set(auth())
        .send({ ranges: [{ start_place: 2, end_place: null, decrement: 4 }] });

      expect(res.status).toBe(400);

      // O DELETE das faixas antigas e o INSERT das novas estão na mesma
      // transação: recusar no COMMIT tem que devolver a tabela ao estado bom.
      const preview = await request(app).get(
        `/api/championships/${championshipId}/points-tables/${tabelaId}/preview?places=2`
      );
      expect(preview.body.data.places.map((p) => p.points)).toEqual([100, 96]);
    });

    test('excluir tabela em uso por um campeonato vira 409, não erro de banco', async () => {
      await pool.query(
        `UPDATE championships SET scoring_model = 'points_table', points_table_id = $2 WHERE id = $1`,
        [championshipId, tabelaId]
      );

      const res = await request(app)
        .delete(`/api/championships/${championshipId}/points-tables/${tabelaId}`)
        .set(auth());

      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/em uso/);
    });

    test('depois de soltar a tabela do campeonato, a exclusão passa', async () => {
      await pool.query(
        `UPDATE championships SET scoring_model = 'legacy', points_table_id = NULL WHERE id = $1`,
        [championshipId]
      );

      const res = await request(app)
        .delete(`/api/championships/${championshipId}/points-tables/${tabelaId}`)
        .set(auth());

      expect(res.status).toBe(200);
      const lista = await request(app).get(`/api/championships/${championshipId}/points-tables`);
      expect(lista.body.data).toHaveLength(0);
    });
  });
});
