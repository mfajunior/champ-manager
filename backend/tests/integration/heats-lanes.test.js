const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * Remanejamento manual de raias (migration 016).
 *
 * O gerador distribui as equipes, mas o organizador precisa poder corrigir no
 * dia: atleta que compete em duas categorias e caiu em baterias simultâneas,
 * dupla que chegou atrasada, equipe que pediu para competir mais cedo.
 *
 * Duas operações. TROCAR é segura por construção — os tamanhos das baterias
 * não mudam. MOVER cobre o que a troca não alcança: com a distribuição
 * equilibrada as baterias têm tamanhos diferentes, e passar alguém da cheia
 * para a que sobrou raia não é uma troca.
 *
 * O CENÁRIO
 * Três raias por bateria, duas categorias com time caps diferentes (300s e
 * 600s) e duas equipes em cada — então cada bateria usa duas raias e sobra a
 * terceira, que é o espaço livre de que o teste de MOVER precisa. A ordem fixa de disputa (nível -> gênero) põe
 * as Iniciante na bateria 1 e as RX na 2 — então a bateria 1 dura 300s e a 2
 * dura 600s. Misturar as duas muda essa duração, que é justamente o efeito
 * colateral que precisa ser testado: a duração sai do MAIOR time cap presente,
 * e dela sai o horário de todas as baterias seguintes.
 */
describe('Remanejamento manual de raias (integração com banco real)', () => {
  let token;
  let championshipId;
  let workoutId;
  let heats;
  const equipes = {};

  const lerBaterias = async () => {
    const res = await request(app).get(`/api/workouts/${workoutId}/heats`);
    return res.body.data;
  };

  beforeAll(async () => {
    const email = `jest-lanes-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest Lanes' })).token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest Lanes', date: '2026-12-07', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;

    const categorias = campeonato.body.data.categories;
    const iniciante = categorias.find((c) => c.name === 'Iniciante Feminino');
    const rx = categorias.find((c) => c.name === 'RX Misto');

    for (const [rotulo, categoria] of [
      ['INI-1', iniciante], ['INI-2', iniciante], ['RX-1', rx], ['RX-2', rx],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const equipe = await request(app)
        .post('/api/teams')
        .set('Authorization', `Bearer ${token}`)
        .send({ championship_id: championshipId, category_id: categoria.id, name: rotulo });
      equipes[rotulo] = equipe.body.data.id;
    }

    const workout = await request(app)
      .post('/api/workouts')
      .set('Authorization', `Bearer ${token}`)
      .send({ championship_id: championshipId, workout_number: 1, name: 'WOD Lanes', scoring_type: 'time' });
    workoutId = workout.body.data.id;

    for (const [categoria, cap] of [[iniciante, 300], [rx, 600]]) {
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .put(`/api/workouts/${workoutId}/variants/${categoria.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ description: `variante ${categoria.name}`, time_cap_seconds: cap });
    }

    await request(app)
      .put(`/api/championships/${championshipId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lanes_per_heat: 3, transition_seconds: 60, start_time: '08:00' });

    await request(app)
      .post(`/api/workouts/${workoutId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    heats = await lerBaterias();
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('a geração separa as categorias e a duração sai do time cap de cada uma', () => {
    expect(heats).toHaveLength(2);
    expect(heats[0].teams.map((t) => t.team_name).sort()).toEqual(['INI-1', 'INI-2']);
    expect(heats[1].teams.map((t) => t.team_name).sort()).toEqual(['RX-1', 'RX-2']);
    expect(heats[0].duration_seconds).toBe(300);
    expect(heats[1].duration_seconds).toBe(600);
  });

  test('trocar exige token', async () => {
    const res = await request(app).post('/api/heats/lanes/swap').send({
      heat_team_id_a: heats[0].teams[0].heat_team_id,
      heat_team_id_b: heats[1].teams[0].heat_team_id,
    });
    expect(res.status).toBe(401);
  });

  test('trocar duas equipes inverte bateria e raia, e recalcula a duração', async () => {
    const antes = await lerBaterias();
    const a = antes[0].teams.find((t) => t.team_name === 'INI-1');
    const b = antes[1].teams.find((t) => t.team_name === 'RX-1');

    const res = await request(app)
      .post('/api/heats/lanes/swap')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id_a: a.heat_team_id, heat_team_id_b: b.heat_team_id });

    expect(res.status).toBe(200);

    const depois = await lerBaterias();
    expect(depois[0].teams.map((t) => t.team_name).sort()).toEqual(['INI-2', 'RX-1']);
    expect(depois[1].teams.map((t) => t.team_name).sort()).toEqual(['INI-1', 'RX-2']);

    // A raia é trocada junto com a bateria, não só o heat_id.
    expect(depois[0].teams.find((t) => t.team_name === 'RX-1').lane_number).toBe(a.lane_number);
    expect(depois[1].teams.find((t) => t.team_name === 'INI-1').lane_number).toBe(b.lane_number);

    // As duas baterias agora têm uma RX dentro, então as duas duram 600s.
    expect(depois[0].duration_seconds).toBe(600);
    expect(depois[1].duration_seconds).toBe(600);

    // Desfaz, para os testes seguintes partirem do mesmo lugar.
    const voltaA = depois[1].teams.find((t) => t.team_name === 'INI-1');
    const voltaB = depois[0].teams.find((t) => t.team_name === 'RX-1');
    await request(app)
      .post('/api/heats/lanes/swap')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id_a: voltaA.heat_team_id, heat_team_id_b: voltaB.heat_team_id });
  });

  test('o resultado já lançado acompanha a equipe na troca', async () => {
    const antes = await lerBaterias();
    const comResultado = antes[0].teams.find((t) => t.team_name === 'INI-1');

    await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id: comResultado.heat_team_id, raw_value: 250 });

    const outra = antes[1].teams.find((t) => t.team_name === 'RX-1');
    const res = await request(app)
      .post('/api/heats/lanes/swap')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id_a: comResultado.heat_team_id, heat_team_id_b: outra.heat_team_id });
    expect(res.status).toBe(200);

    // results aponta para heat_team_id, e a bateria é uma coluna dentro dessa
    // linha — o resultado vai junto sem nada para migrar.
    const depois = await lerBaterias();
    const movida = depois[1].teams.find((t) => t.team_name === 'INI-1');
    expect(movida.heat_team_id).toBe(comResultado.heat_team_id);
    expect(Number(movida.raw_value)).toBe(250);

    await request(app)
      .delete(`/api/results/${movida.result_id}`)
      .set('Authorization', `Bearer ${token}`);
    await request(app)
      .post('/api/heats/lanes/swap')
      .set('Authorization', `Bearer ${token}`)
      .send({
        heat_team_id_a: movida.heat_team_id,
        heat_team_id_b: depois[0].teams.find((t) => t.team_name === 'RX-1').heat_team_id,
      });
  });

  test('trocar uma raia consigo mesma é rejeitado (400)', async () => {
    const atual = await lerBaterias();
    const id = atual[0].teams[0].heat_team_id;
    const res = await request(app)
      .post('/api/heats/lanes/swap')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id_a: id, heat_team_id_b: id });
    expect(res.status).toBe(400);
  });

  test('mover para uma raia ocupada é rejeitado (409) e aponta a troca', async () => {
    const atual = await lerBaterias();
    const origem = atual[0].teams[0];
    const destino = atual[1].teams[0];

    const res = await request(app)
      .put(`/api/heats/lanes/${origem.heat_team_id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_id: atual[1].id, lane_number: destino.lane_number });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/troca/i);
  });

  test('mover para raia fora do número de raias do box é rejeitado (400)', async () => {
    const atual = await lerBaterias();
    const res = await request(app)
      .put(`/api/heats/lanes/${atual[0].teams[0].heat_team_id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_id: atual[1].id, lane_number: 9 });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/3 raias/);
  });

  test('mover para a raia livre da outra bateria funciona', async () => {
    const antes = await lerBaterias();
    const equipe = antes[0].teams.find((t) => t.team_name === 'INI-1');

    // Cada bateria usa 2 das 3 raias, então a raia 3 está livre nas duas.
    const res = await request(app)
      .put(`/api/heats/lanes/${equipe.heat_team_id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_id: antes[1].id, lane_number: 3 });

    expect(res.status).toBe(200);

    const depois = await lerBaterias();
    expect(depois[0].teams.map((t) => t.team_name)).toEqual(['INI-2']);
    expect(depois[1].teams.map((t) => t.team_name).sort()).toEqual(['INI-1', 'RX-1', 'RX-2']);
    expect(depois[1].teams.find((t) => t.team_name === 'INI-1').lane_number).toBe(3);

    // A bateria 1 ficou só com a Iniciante: a duração volta para 300s. A 2
    // continua em 600s, porque a RX ainda manda nela.
    expect(depois[0].duration_seconds).toBe(300);
    expect(depois[1].duration_seconds).toBe(600);

    // Nenhuma equipe perdida no caminho.
    expect(depois.reduce((n, h) => n + h.teams.length, 0)).toBe(4);
  });

  test('mover para uma bateria de outra prova é rejeitado (400)', async () => {
    const outraProva = await request(app)
      .post('/api/workouts')
      .set('Authorization', `Bearer ${token}`)
      .send({ championship_id: championshipId, workout_number: 2, name: 'Outra', scoring_type: 'time' });

    await request(app)
      .post(`/api/workouts/${outraProva.body.data.id}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const dela = await request(app).get(`/api/workouts/${outraProva.body.data.id}/heats`);
    const atual = await lerBaterias();

    const res = await request(app)
      .put(`/api/heats/lanes/${atual[0].teams[0].heat_team_id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_id: dela.body.data[0].id, lane_number: 3 });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/mesma prova/i);
  });
});
