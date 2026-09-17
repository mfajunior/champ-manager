// src/server.js
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
║      🏆 CHAMPY BACKEND STARTED         ║
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
