const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { pool } = require('../../src/config/database');

/**
 * A agenda do dia: que horas cada bateria começa.
 *
 * Dois bugs reais motivaram estes testes, e os dois vinham da mesma causa — a
 * âncora do horário era "a última bateria já agendada de qualquer prova", sem
 * olhar o número da prova:
 *
 *   1. ORDEM. Gerar a prova 2 antes da 1 colocava a 2 às 08:00 e a 1 DEPOIS
 *      dela. O dia saía fora de ordem.
 *   2. PROPAGAÇÃO. Regerar a prova 1 com mais equipes a fazia terminar mais
 *      tarde, mas as provas seguintes mantinham os horários antigos — o dia
 *      ficava sobreposto, e em silêncio.
 *
 * Agora a agenda inteira é recalculada a cada mudança, na ordem das provas.
 * O resultado passa a ser função de (hora de início, transição, durações), e
 * não da ordem em que o organizador clicou.
 *
 * Cenário: início às 08:00, transição de 60s, 2 raias, 4 equipes numa
 * categoria, time cap de 600s. Cada prova vira 2 baterias de 10 minutos.
 */
describe('Agenda das baterias', () => {
  let token;
  let championshipId;
  let categoriaId;
  let provaUmId;
  let provaDoisId;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  /** "2026-12-12T08:00:00.000Z" -> "08:00" (o campo é horário de parede) */
  const hora = (iso) => (iso ? String(iso).slice(11, 16) : null);

  const horariosDa = async (provaId) => {
    const res = await request(app).get(`/api/workouts/${provaId}/heats`);
    return res.body.data.map((h) => hora(h.scheduled_time));
  };

  const gerar = (provaId, body = {}) =>
    request(app).post(`/api/workouts/${provaId}/heats`).set(auth()).send(body);

  beforeAll(async () => {
    const email = `jest-agenda-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest Agenda' })).token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set(auth())
      .send({ name: 'Jest Agenda Championship', date: '2026-12-12', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;
    categoriaId = campeonato.body.data.categories[0].id;

    await request(app)
      .put(`/api/championships/${championshipId}`)
      .set(auth())
      .send({ lanes_per_heat: 2, transition_seconds: 60, start_time: '08:00' });

    for (const nome of ['A', 'B', 'C', 'D']) {
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post('/api/teams')
        .set(auth())
        .send({ championship_id: championshipId, category_id: categoriaId, name: nome });
    }

    for (const numero of [1, 2]) {
      // eslint-disable-next-line no-await-in-loop
      const prova = await request(app)
        .post('/api/workouts')
        .set(auth())
        .send({
          championship_id: championshipId,
          workout_number: numero,
          name: `WOD Agenda ${numero}`,
          scoring_type: 'time',
        });
      const provaId = prova.body.data.id;
      if (numero === 1) provaUmId = provaId;
      else provaDoisId = provaId;

      // Sem time cap a bateria não tem duração conhecida e o dia fica sem
      // horário — é a duração que encadeia a agenda.
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .put(`/api/workouts/${provaId}/variants/${categoriaId}`)
        .set(auth())
        .send({ description: 'AMRAP 10', time_cap_seconds: 600 });
    }
  });

  afterAll(async () => {
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await pool.end();
  });

  test('gerar a prova 2 primeiro NÃO a coloca no início do dia', async () => {
    await gerar(provaDoisId);
    // Sozinha no campeonato, ela ocupa o começo — não há prova 1 gerada ainda.
    expect(await horariosDa(provaDoisId)).toEqual(['08:00', '08:11']);

    await gerar(provaUmId);

    // Ao gerar a prova 1, a agenda inteira é refeita na ordem das provas: a 1
    // assume o início do dia e a 2 é empurrada para depois dela, mesmo tendo
    // sido gerada antes. É o caso que a lógica antiga errava.
    expect(await horariosDa(provaUmId)).toEqual(['08:00', '08:11']);
    expect(await horariosDa(provaDoisId)).toEqual(['08:22', '08:33']);
  });

  test('o horário de início configurado vale para a prova 1', async () => {
    const primeira = (await horariosDa(provaUmId))[0];
    expect(primeira).toBe('08:00');
  });

  test('a transição também vale entre a última bateria de uma prova e a primeira da próxima', async () => {
    // Prova 1 termina 08:11 + 10min = 08:21. Com 60s de transição, a prova 2
    // começa 08:22 — não 08:21.
    expect((await horariosDa(provaDoisId))[0]).toBe('08:22');
  });

  test('crescer a prova 1 empurra as provas seguintes', async () => {
    // Duas equipes a mais viram uma terceira bateria na prova 1.
    for (const nome of ['E', 'F']) {
      // eslint-disable-next-line no-await-in-loop
      await request(app)
        .post('/api/teams')
        .set(auth())
        .send({ championship_id: championshipId, category_id: categoriaId, name: nome });
    }

    await gerar(provaUmId, { force: true });

    expect(await horariosDa(provaUmId)).toEqual(['08:00', '08:11', '08:22']);
    // A prova 2 foi regerada junto (ganhou equipes) e começa depois da 1.
    expect((await horariosDa(provaDoisId))[0]).toBe('08:33');
  });

  test('mudar a hora de início desloca o dia inteiro, sem regerar bateria nenhuma', async () => {
    await request(app)
      .put(`/api/championships/${championshipId}`)
      .set(auth())
      .send({ start_time: '09:30' });

    expect((await horariosDa(provaUmId))[0]).toBe('09:30');
    expect((await horariosDa(provaDoisId))[0]).toBe('10:03');
  });

  test('mudar a transição reespaça o dia inteiro', async () => {
    await request(app)
      .put(`/api/championships/${championshipId}`)
      .set(auth())
      .send({ transition_seconds: 120 });

    // 09:30 + 10min + 2min = 09:42 na segunda bateria.
    expect((await horariosDa(provaUmId))[1]).toBe('09:42');
  });

  test('intervalo depois da prova 1 empurra a prova 2, e só ela', async () => {
    const antesProvaUm = await horariosDa(provaUmId);
    const [antesProvaDois] = await horariosDa(provaDoisId);

    await request(app)
      .put(`/api/workouts/${provaUmId}`)
      .set(auth())
      .send({ break_after_seconds: 60 * 60 });

    // A prova que tem o intervalo não se move: o intervalo é DEPOIS dela.
    expect(await horariosDa(provaUmId)).toEqual(antesProvaUm);

    // A seguinte anda exatamente uma hora.
    const [depoisProvaDois] = await horariosDa(provaDoisId);
    const paraMinutos = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
    expect(paraMinutos(depoisProvaDois) - paraMinutos(antesProvaDois)).toBe(60);
  });

  test('remover o intervalo devolve a prova 2 ao horário anterior', async () => {
    const [comIntervalo] = await horariosDa(provaDoisId);

    await request(app)
      .put(`/api/workouts/${provaUmId}`)
      .set(auth())
      .send({ break_after_seconds: null });

    const [semIntervalo] = await horariosDa(provaDoisId);
    const paraMinutos = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
    expect(paraMinutos(comIntervalo) - paraMinutos(semIntervalo)).toBe(60);
  });

  test('apagar a prova 1 faz a prova 2 subir para o início do dia', async () => {
    await request(app).delete(`/api/workouts/${provaUmId}`).set(auth());
    expect((await horariosDa(provaDoisId))[0]).toBe('09:30');
  });
});
