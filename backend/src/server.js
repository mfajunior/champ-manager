// src/server.js

/**
 * O fuso do processo é fixado ANTES de qualquer outro require, porque o Node
 * lê process.env.TZ na primeira vez que um Date é construído — depois disso,
 * mudar a variável não tem mais efeito garantido.
 *
 * Por que fixar: sem isso, o fuso é o da máquina onde o backend estiver
 * rodando. No PC do organizador é UTC-3; num container ou na Render é UTC. O
 * mesmo código passava a se comportar de dois jeitos, e descobrir isso no dia
 * do evento é tarde demais.
 *
 * Isto NÃO é o que faz o horário das baterias funcionar — esse caminho não
 * constrói Date nenhum (ver models/schedule.js e frontend/src/lib/format.ts).
 * É rede de segurança para todo o resto que ainda usa Date: datas de
 * campeonato, carimbos de criação, e qualquer código futuro que esqueça o
 * cuidado.
 *
 * A variável continua podendo ser sobrescrita pelo ambiente, para não travar
 * quem um dia rodar isto fora do Brasil.
 */
process.env.TZ = process.env.TZ || 'America/Sao_Paulo';

const http = require('http');
const app = require('./app');
const { attachSocket } = require('./socket');
const { pool } = require('./config/database');

require('dotenv').config();

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Cria servidor HTTP com Socket.io para real-time leaderboard.
 * A montagem do socket em si (conexão, sala por campeonato, broadcast) vive
 * em src/socket.js — separado daqui justamente para poder ser testado
 * (ver tests/integration/websocket.test.js).
 */
const server = http.createServer(app);
const { io, broadcastLeaderboardUpdate } = attachSocket(server);

// Exporta io e broadcast para uso em rotas (resultController lê daqui).
app.locals.io = io;
app.locals.broadcastLeaderboardUpdate = broadcastLeaderboardUpdate;

/**
 * Database Connection Check
 */
const checkDatabase = async () => {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connected:', result.rows[0]);
    return true;
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    return false;
  }
};

/**
 * Start Server
 */
const startServer = async () => {
  // Verifica conexão com banco de dados
  const dbConnected = await checkDatabase();
  if (!dbConnected) {
    console.error('Cannot start server without database connection');
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║      🏆 SCOREUP BACKEND STARTED        ║
╠════════════════════════════════════════╣
║ Environment: ${NODE_ENV.toUpperCase().padEnd(24)} ║
║ Port:        ${PORT.toString().padEnd(26)} ║
║ Health:      http://localhost:${PORT}/health     ║
╚════════════════════════════════════════╝
    `);
  });
};

/**
 * Graceful Shutdown
 */
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(async () => {
    await pool.end();
    console.log('Server and database connections closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close(async () => {
    await pool.end();
    console.log('Server and database connections closed');
    process.exit(0);
  });
});

/**
 * Uncaught Exception Handler
 */
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Inicia o servidor
startServer();
