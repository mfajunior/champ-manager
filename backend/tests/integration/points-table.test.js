const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * Modelo de pontuação points_table (migrations 011 e 012).
 *
 * A regra mora inteira no banco, então o teste também: campeonato, equipes,
 * provas e resultados entram pela API (que já existe), e tabela de pontos,
 * faixas e cortes entram por SQL, porque os endpoints deles ainda não foram
 * escritos. As asserções olham team_standings direto pelo mesmo motivo — o
 * fetchStandings ainda devolve o contrato antigo; quando o backend for
 * ajustado, elas migram para o /api/leaderboard.
 *
 * Tabela usada nos testes: 1º ao 3º caindo 5, 4º ao 7º caindo 3, 8º em diante
 * caindo 2, partindo de 100. Dá 100, 95, 90, 87, 84 para as cinco primeiras.
 */
describe('Pontuação estilo CrossFit Games (points_table)', () => {
  let token;
  let championshipId;
  let categoriaId;
  let provaUmId;
  let provaDoisId;
  let pointsTableId;
  const equipes = {}; // nome -> id

  const standings = async () => {
    const { rows } = await pool.query(
      `SELECT t.name, ts.total_points, ts.total_score, ts."place", ts.is_cut, ts.workouts_completed
         FROM team_standings ts JOIN teams t ON t.id = ts.team_id
        WHERE ts.championship_id = $1`,
      [championshipId]
    );
    return Object.fromEntries(rows.map((r) => [r.name, r]));
  };

  const lancarResultados = async (provaId, valoresPorNome) => {
    const baterias = await request(app).get(`/api/workouts/${provaId}/heats`);
    for (const raia of baterias.body.data.flatMap((h) => h.teams)) {
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post('/api/results')
        .set('Authorization', `Bearer ${token}`)
        .send({ heat_team_id: raia.heat_team_id, raw_value: valoresPorNome[raia.team_name] });
    }
  };

  beforeAll(async () => {
    const email = `jest-points-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest Points' })).token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest Points Championship', date: '2026-12-07', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;
    categoriaId = campeonato.body.data.categories[0].id;

    await request(app)
      .put(`/api/championships/${championshipId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lanes_per_heat: 5 });

    for (const nome of ['T1', 'T2', 'T3', 'T4', 'T5']) {
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
          name: `WOD Points ${numero}`,
          scoring_type: 'time',
        });
      if (numero === 1) provaUmId = prova.body.data.id;
      else provaDoisId = prova.body.data.id;
    }

    const tabela = await pool.query(
      `INSERT INTO points_tables (championship_id, name) VALUES ($1, 'Jest') RETURNING id`,
      [championshipId]
    );
    pointsTableId = tabela.rows[0].id;
    await pool.query(
      `INSERT INTO points_table_ranges (points_table_id, start_place, end_place, decrement)
       VALUES ($1,1,3,5), ($1,4,7,3), ($1,8,NULL,2)`,
      [pointsTableId]
    );
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('campeonato nasce no modelo legacy', async () => {
    const { rows } = await pool.query('SELECT scoring_model FROM championships WHERE id = $1', [
      championshipId,
    ]);
    expect(rows[0].scoring_model).toBe('legacy');
  });

  test('ligar o modelo novo sem escolher a tabela é recusado pelo banco', async () => {
    await expect(
      pool.query(`UPDATE championships SET scoring_model = 'points_table' WHERE id = $1`, [
        championshipId,
      ])
    ).rejects.toThrow(/chk_points_table_required/);
  });

  test('faixas precisam cobrir da 1ª colocação em diante, sem buraco', async () => {
    const outra = await pool.query(
      `INSERT INTO points_tables (championship_id, name) VALUES ($1, 'Quebrada') RETURNING id`,
      [championshipId]
    );
    // Começa na 3ª e não tem faixa aberta: os dois motivos de recusa.
    await expect(
      pool.query(
        `INSERT INTO points_table_ranges (points_table_id, start_place, end_place, decrement)
         VALUES ($1, 3, 10, 5)`,
        [outra.rows[0].id]
      )
    ).rejects.toThrow(/1ª colocação/);
    await pool.query('DELETE FROM points_tables WHERE id = $1', [outra.rows[0].id]);
  });

  test('com a tabela escolhida, os pontos seguem as faixas', async () => {
    await pool.query(
      `UPDATE championships SET scoring_model = 'points_table', points_table_id = $2 WHERE id = $1`,
      [championshipId, pointsTableId]
    );
    await request(app)
      .post(`/api/workouts/${provaUmId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    await lancarResultados(provaUmId, { T1: 100, T2: 200, T3: 300, T4: 400, T5: 500 });

    const s = await standings();
    expect(s.T1.total_points).toBe(100);
    expect(s.T2.total_points).toBe(95);
    expect(s.T3.total_points).toBe(90);
    expect(s.T4.total_points).toBe(87); // virada de faixa: vale o decremento da faixa nova
    expect(s.T5.total_points).toBe(84);
    expect(s.T1.place).toBe(1); // mais pontos lidera, ao contrário do legacy
    expect(s.T5.place).toBe(5);
  });

  test('empate divide a colocação e pula a seguinte (1-2-2-4)', async () => {
    const { rows: raia } = await pool.query(
      `SELECT r.id FROM results r JOIN heat_teams ht ON ht.id = r.heat_team_id
        WHERE ht.team_id = $1`,
      [equipes.T3]
    );
    await pool.query('UPDATE results SET raw_value = 200 WHERE id = $1', [raia[0].id]);

    const s = await standings();
    expect(s.T2.total_points).toBe(s.T3.total_points); // empatadas levam o mesmo
    const { rows: place4 } = await pool.query(
      `SELECT r."place" FROM results r JOIN heat_teams ht ON ht.id = r.heat_team_id
        WHERE ht.team_id = $1`,
      [equipes.T4]
    );
    expect(place4[0].place).toBe(4); // a seguinte é 4ª, não 3ª

    await pool.query('UPDATE results SET raw_value = 300 WHERE id = $1', [raia[0].id]);
  });

  test('alterar a régua reescreve o placar sem ninguém chamar recálculo', async () => {
    await pool.query(
      `UPDATE points_table_ranges SET decrement = 10 WHERE points_table_id = $1 AND start_place = 1`,
      [pointsTableId]
    );
    let s = await standings();
    expect(s.T2.total_points).toBe(90); // 100 - 10
    expect(s.T4.total_points).toBe(77);

    await pool.query(
      `UPDATE points_table_ranges SET decrement = 5 WHERE points_table_id = $1 AND start_place = 1`,
      [pointsTableId]
    );
    s = await standings();
    expect(s.T2.total_points).toBe(95);
  });

  test('a faixa aberta cobre qualquer colocação e trava em zero', async () => {
    const { rows } = await pool.query(
      `SELECT points_for_place($1, 11) AS p11, points_for_place($1, 18) AS p18,
              points_for_place($1, 46) AS p46, points_for_place($1, 99) AS p99`,
      [pointsTableId]
    );
    expect(rows[0]).toMatchObject({ p11: 70, p18: 56, p46: 0, p99: 0 });
  });

  test('corte por prova: só o top 3 disputa, e os cortados caem no placar', async () => {
    await pool.query(
      `INSERT INTO workout_cuts (workout_id, category_id, keep_top_n) VALUES ($1, NULL, 3)`,
      [provaDoisId]
    );

    const { rows: elegiveis } = await pool.query(
      `SELECT t.name FROM eligible_teams_for_workout($1, $2) e JOIN teams t ON t.id = e
        ORDER BY t.name`,
      [provaDoisId, categoriaId]
    );
    expect(elegiveis.map((r) => r.name)).toEqual(['T1', 'T2', 'T3']);

    // O corte sozinho já recalcula: ninguém forçou nada aqui.
    const s = await standings();
    expect(s.T1.is_cut).toBe(false);
    expect(s.T4.is_cut).toBe(true);
    expect(s.T5.is_cut).toBe(true);
    expect(s.T4.total_points).toBe(87); // cortada mantém o que já tinha
    expect(s.T4.place).toBe(4); // e fica abaixo de quem continua
  });

  test('prova sem corte configurado é disputada por todas', async () => {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM eligible_teams_for_workout($1, $2)',
      [provaUmId, categoriaId]
    );
    expect(rows[0].n).toBe(5);
  });

  test('apagar a bateria zera os pontos também no modelo novo (migration 010)', async () => {
    await pool.query('DELETE FROM heats WHERE workout_id = $1', [provaUmId]);
    const s = await standings();
    expect(s.T1.total_points).toBe(0);
    expect(s.T1.workouts_completed).toBe(0);
  });
});
