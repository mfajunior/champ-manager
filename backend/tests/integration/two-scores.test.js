const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * Prova com DUAS pontuações independentes e desempate (migrations 014 e 015).
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * A feature foi escrita sem teste nenhum, e isso cobrou o preço: o placar
 * público mostrava "180 repetições" como "03:00" porque a consulta devolvia
 * um scoring_type só — o da PROVA — e a tela formatava as duas linhas com
 * ele. Um bug de exibição que nenhum teste de rota pegaria, porque a rota
 * respondia 200 com o número certo; só o TIPO estava errado.
 *
 * Por isso os testes daqui não param em "respondeu 200". Eles verificam o
 * significado de cada campo: qual pontuação cada linha representa, com qual
 * tipo ela deve ser lida, e se as duas colocações são mesmo independentes.
 *
 * O CENÁRIO
 * Uma prova For Time (menor é melhor) com segunda pontuação AMRAP (maior é
 * melhor) e desempate ligado. Os números foram escolhidos para que as duas
 * colocações discordem entre si — se o código confundisse uma com a outra,
 * ou aplicasse o tipo errado, os resultados esperados mudariam:
 *
 *   equipe   pontuação 1     desempate   pontuação 2    →  coloc. 1   coloc. 2
 *   A        300s            60s         100 reps          2º         3º
 *   B        300s            50s         150 reps          1º         2º
 *   C        400s            —           200 reps          3º         1º
 *
 * A e B empatam em 300s: quem decide é o desempate (50 < 60), e é a única
 * coisa que o decide. C é a última no tempo e a primeira nas repetições —
 * a inversão que prova que uma colocação não influencia a outra.
 */
describe('Prova com duas pontuações e desempate (integração com banco real)', () => {
  let token;
  let championshipId;
  let workoutId;
  let categoryId;
  const equipes = {};
  const raias = {};

  beforeAll(async () => {
    const email = `jest-2scores-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest Duas Pontuacoes' })).token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest 2 Scores', date: '2026-12-06', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;
    categoryId = campeonato.body.data.categories[0].id;

    for (const nome of ['A', 'B', 'C']) {
      const equipe = await request(app)
        .post('/api/teams')
        .set('Authorization', `Bearer ${token}`)
        .send({ championship_id: championshipId, category_id: categoryId, name: `Equipe ${nome}` });
      equipes[nome] = equipe.body.data.id;
    }

    const workout = await request(app)
      .post('/api/workouts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        championship_id: championshipId,
        workout_number: 1,
        name: 'WOD Duas Pontuacoes',
        scoring_type: 'time',
      });
    workoutId = workout.body.data.id;

    // A segunda pontuação e o desempate são configurados DEPOIS de criar a
    // prova, que é o fluxo real da tela: o organizador cria a prova e só
    // então marca a caixa.
    await request(app)
      .put(`/api/workouts/${workoutId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scoring_type_2: 'reps', has_tiebreak: true });

    await request(app)
      .put(`/api/championships/${championshipId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lanes_per_heat: 4 });

    await request(app)
      .post(`/api/workouts/${workoutId}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const heats = await request(app).get(`/api/workouts/${workoutId}/heats`);
    for (const lane of heats.body.data[0].teams) {
      raias[lane.team_name.replace('Equipe ', '')] = lane.heat_team_id;
    }

    const lancar = async (nome, valor1, desempate, valor2) => {
      await request(app)
        .post('/api/results')
        .set('Authorization', `Bearer ${token}`)
        .send({
          heat_team_id: raias[nome],
          raw_value: valor1,
          score_index: 1,
          tiebreak_seconds: desempate,
        });
      await request(app)
        .post('/api/results')
        .set('Authorization', `Bearer ${token}`)
        .send({
          heat_team_id: raias[nome],
          raw_value: valor2,
          score_index: 2,
          tiebreak_seconds: desempate,
        });
    };

    await lancar('A', 300, 60, 100);
    await lancar('B', 300, 50, 150);
    await lancar('C', 400, null, 200);
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('a raia aparece UMA vez por equipe, carregando os dois resultados', async () => {
    const heats = await request(app).get(`/api/workouts/${workoutId}/heats`);
    const lanes = heats.body.data[0].teams;

    // A consulta das raias faz dois LEFT JOIN em results, um por score_index.
    // Um LEFT JOIN simples devolveria a mesma equipe DUAS vezes na bateria —
    // seis linhas para três equipes — e a tela mostraria raias fantasmas.
    expect(lanes).toHaveLength(3);
    expect(new Set(lanes.map((l) => l.team_name)).size).toBe(3);

    for (const lane of lanes) {
      expect(lane.result_id).not.toBeNull();
      expect(lane.result_id_2).not.toBeNull();
      expect(lane.result_id).not.toBe(lane.result_id_2);
    }
  });

  test('as duas colocações são independentes — a última no tempo é a primeira nas repetições', async () => {
    const heats = await request(app).get(`/api/workouts/${workoutId}/heats`);
    const porEquipe = Object.fromEntries(
      heats.body.data[0].teams.map((l) => [l.team_name, l])
    );

    expect(porEquipe['Equipe B'].place).toBe(1);
    expect(porEquipe['Equipe A'].place).toBe(2);
    expect(porEquipe['Equipe C'].place).toBe(3);

    expect(porEquipe['Equipe C'].place_2).toBe(1);
    expect(porEquipe['Equipe B'].place_2).toBe(2);
    expect(porEquipe['Equipe A'].place_2).toBe(3);
  });

  test('o desempate decide um empate na pontuação 1 — e só ele', async () => {
    // A e B fizeram o mesmo tempo (300s). Sem o desempate, RANK() daria 1º
    // para as duas. Com ele, quem tem o round mais rápido passa na frente.
    const heats = await request(app).get(`/api/workouts/${workoutId}/heats`);
    const porEquipe = Object.fromEntries(
      heats.body.data[0].teams.map((l) => [l.team_name, l])
    );

    expect(Number(porEquipe['Equipe A'].raw_value)).toBe(Number(porEquipe['Equipe B'].raw_value));
    expect(Number(porEquipe['Equipe B'].tiebreak_seconds)).toBeLessThan(
      Number(porEquipe['Equipe A'].tiebreak_seconds)
    );
    expect(porEquipe['Equipe B'].place).toBeLessThan(porEquipe['Equipe A'].place);
  });

  test('o histórico da raia diz a QUAL pontuação cada evento pertence', async () => {
    // O histórico é consultado pela raia, não pelo resultado, então numa prova
    // de duas pontuações as duas histórias chegam na mesma lista. Sem
    // score_index (migration 015) não há como separá-las nem como formatar
    // cada valor com o tipo certo.
    const res = await request(app)
      .get(`/api/results/heat-teams/${raias['A']}/history`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);

    const porIndice = Object.fromEntries(res.body.data.map((h) => [h.score_index, h]));
    expect(Number(porIndice[1].raw_value)).toBe(300);
    expect(Number(porIndice[2].raw_value)).toBe(100);
  });

  test('cada linha do histórico da equipe chega com o tipo da PRÓPRIA pontuação', async () => {
    // A regressão que motivou este arquivo: as duas linhas vinham com
    // scoring_type 'time' (o da prova), então 100 repetições eram exibidas
    // como "01:40".
    const res = await request(app).get(`/api/teams/${equipes['A']}/results`);

    expect(res.status).toBe(200);
    const linhas = res.body.data.workouts.filter((w) => w.workout_id === workoutId);
    expect(linhas).toHaveLength(2);

    const porIndice = Object.fromEntries(linhas.map((l) => [l.score_index, l]));
    expect(porIndice[1].scoring_type).toBe('time');
    expect(porIndice[2].scoring_type).toBe('reps');
  });

  test('GET /api/results também devolve o tipo por linha, não só o da prova', async () => {
    const res = await request(app).get(
      `/api/results?workout_id=${workoutId}&category_id=${categoryId}`
    );

    expect(res.status).toBe(200);
    expect(res.body.meta.scoringType).toBe('time');
    expect(res.body.meta.scoringType2).toBe('reps');

    for (const linha of res.body.data) {
      expect(linha.scoring_type).toBe(linha.score_index === 2 ? 'reps' : 'time');
    }
  });

  test('a prova de duas pontuações pesa o dobro no placar geral', async () => {
    // No modelo legado o total é a SOMA das colocações (menor é melhor), e as
    // duas colocações entram nela: B soma 1+2, C soma 3+1, A soma 2+3. É a
    // consequência aceita de propósito quando se marca "duas pontuações" —
    // a prova vale por duas.
    const res = await request(app).get(`/api/leaderboard?championship_id=${championshipId}`);

    expect(res.status).toBe(200);
    const porEquipe = Object.fromEntries(res.body.data.map((t) => [t.team_name, t]));

    expect(Number(porEquipe['Equipe B'].total_score)).toBe(3);
    expect(Number(porEquipe['Equipe C'].total_score)).toBe(4);
    expect(Number(porEquipe['Equipe A'].total_score)).toBe(5);

    expect(porEquipe['Equipe B'].place).toBe(1);
    expect(porEquipe['Equipe C'].place).toBe(2);
    expect(porEquipe['Equipe A'].place).toBe(3);
  });
});
