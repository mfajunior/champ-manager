const http = require('http');
const { io: ioClient } = require('socket.io-client');
const request = require('supertest');
const app = require('../../src/app');
const { createTestUser } = require('../helpers/testAuth');
const { attachSocket } = require('../../src/socket');
const { pool } = require('../../src/config/database');

/**
 * Até aqui o broadcast do leaderboard só tinha sido validado manualmente
 * (backend/test-websocket.js + trigger-test-broadcast.ps1, rodando o backend
 * de verdade numa janela e um cliente noutra). Isso prova que funciona uma
 * vez, mas não impede alguém de quebrar o broadcast sem perceber na próxima
 * mudança em resultController — nenhum teste automatizado cobria isso.
 *
 * Diferente dos outros arquivos de integração, este sobe um http.createServer
 * de verdade com Socket.io ligado (via src/socket.js, extraído de server.js
 * só para isso), porque supertest sozinho nunca chama server.listen — e sem
 * um servidor de verdade escutando numa porta, não existe conexão de socket
 * pra testar.
 */
describe('Broadcast do leaderboard via WebSocket (integração)', () => {
  let server;
  let port;
  let token;
  let championshipId;
  let heatTeamId;
  let firstResultId;

  beforeAll(async () => {
    server = http.createServer(app);
    const { broadcastLeaderboardUpdate } = attachSocket(server);
    // Mesma ponte que server.js monta em produção: resultController lê
    // req.app.locals.broadcastLeaderboardUpdate, não importa quem a colocou lá.
    app.locals.broadcastLeaderboardUpdate = broadcastLeaderboardUpdate;

    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;

    const email = `jest-ws-${Date.now()}-${Math.random().toString(36).slice(2)}@champy.local`;
    token = (await createTestUser({ email, name: 'Jest WS' })).token;

    const campeonato = await request(app)
      .post('/api/championships')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jest WS Championship', date: '2026-11-20', location: 'Box Jest' });
    championshipId = campeonato.body.data.id;
    const categoryId = campeonato.body.data.categories[0].id;

    await request(app)
      .post('/api/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ championship_id: championshipId, category_id: categoryId, name: 'Equipe WS' });

    const workout = await request(app)
      .post('/api/workouts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        championship_id: championshipId,
        workout_number: 1,
        name: 'WOD WS',
        scoring_type: 'time',
      });

    // lanes_per_heat virou parâmetro global do campeonato (migration 005).
    await request(app)
      .put(`/api/championships/${championshipId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lanes_per_heat: 4 });

    await request(app)
      .post(`/api/workouts/${workout.body.data.id}/heats`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const heats = await request(app).get(`/api/workouts/${workout.body.data.id}/heats`);
    heatTeamId = heats.body.data[0].teams[0].heat_team_id;
  });

  afterAll(async () => {
    delete app.locals.broadcastLeaderboardUpdate;
    if (championshipId) {
      await pool.query('DELETE FROM championships WHERE id = $1', [championshipId]);
    }
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  const connectClient = () =>
    new Promise((resolve, reject) => {
      const client = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
      });
      client.once('connect', () => resolve(client));
      client.once('connect_error', reject);
    });

  test('cliente inscrito na sala do campeonato recebe leaderboard_updated ao lançar um resultado', async () => {
    const client = await connectClient();
    client.emit('subscribe_championship', championshipId);
    // dá um tick pro `socket.join` (que roda dentro do handler do servidor)
    // terminar antes do POST — sem isso o broadcast pode disparar antes do
    // cliente estar de fato na sala.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const eventoRecebido = new Promise((resolve) => client.once('leaderboard_updated', resolve));

    const criado = await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${token}`)
      .send({ heat_team_id: heatTeamId, raw_value: 250 });
    firstResultId = criado.body.data.id;

    const standings = await eventoRecebido;

    expect(Array.isArray(standings)).toBe(true);
    expect(
      standings.some((row) => row.team_name === 'Equipe WS' && row.place === 1)
    ).toBe(true);

    client.close();
  });

  test('cliente que não se inscreveu em nenhum campeonato não recebe o evento', async () => {
    const client = await connectClient();
    // propositalmente NÃO emite subscribe_championship

    let recebeu = false;
    client.on('leaderboard_updated', () => {
      recebeu = true;
    });

    // corrigir o resultado já lançado também dispara broadcast — é o mesmo
    // caminho de código (resultController.update chama broadcastLeaderboard).
    await request(app)
      .put(`/api/results/${firstResultId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ raw_value: 240 });

    // Não tem evento "não vai chegar" pra esperar — dá um tempo razoável e
    // confirma que nada chegou nesse meio tempo. Servidor e cliente rodam no
    // mesmo processo local, então mesmo poucos milissegundos já seriam
    // suficientes se o isolamento por sala estivesse quebrado.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(recebeu).toBe(false);
    client.close();
  });
});
