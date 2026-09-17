// src/socket.js
const { Server } = require('socket.io');

/**
 * A montagem do Socket.io morava inteira dentro de server.js — o que
 * funcionava para rodar o backend, mas não dava para testar: um teste de
 * integração fala com `app` via supertest, sem nunca chamar `server.listen`,
 * então `app.locals.broadcastLeaderboardUpdate` nunca existia durante os
 * testes (é por isso que resultController.broadcastLeaderboard tem um early
 * return quando essa função não existe).
 *
 * Separar essa lógica numa função própria (`attachSocket`) permite ao teste
 * subir um `http.createServer(app)` de verdade, ligar o Socket.io nele do
 * mesmo jeito que server.js faz em produção, e um cliente `socket.io-client`
 * de verdade se inscrever e escutar o evento — sem duplicar a lógica de
 * conexão/broadcast num "modo de teste" à parte.
 */
const attachSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    socket.on('subscribe_championship', (championshipId) => {
      socket.join(`championship:${championshipId}`);
    });
  });

  const broadcastLeaderboardUpdate = (championshipId, data) => {
    io.to(`championship:${championshipId}`).emit('leaderboard_updated', data);
  };

  return { io, broadcastLeaderboardUpdate };
};

module.exports = { attachSocket };
