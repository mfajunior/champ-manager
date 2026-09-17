const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const app = express();

// ==================== MIDDLEWARE ====================

// Security
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging (silencioso em teste — só polui a saída do Jest)
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ==================== ROUTES ====================

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

const championshipRoutes = require('./routes/championships');
app.use('/api/championships', championshipRoutes);

const teamRoutes = require('./routes/teams');
app.use('/api/teams', teamRoutes);

// Provas, suas variantes por categoria e a geração de baterias
const workoutRoutes = require('./routes/workouts');
app.use('/api/workouts', workoutRoutes);

// Operações sobre uma bateria já existente (horário, status)
const heatRoutes = require('./routes/heats');
app.use('/api/heats', heatRoutes);

// Lançamento de desempenho bruto (tempo/reps/carga) e colocação calculada
const resultsRoutes = require('./routes/results');
app.use('/api/results', resultsRoutes);

// Ranking por categoria, mantido pelo trigger em cima de results (só leitura)
const leaderboardRoutes = require('./routes/leaderboard');
app.use('/api/leaderboard', leaderboardRoutes);

// ==================== ERROR HANDLING ====================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Rota ${req.method} ${req.path} não encontrada`
    }
  });
});

// Centralized error handler
app.use((err, req, res, next) => {
  console.error(JSON.stringify({
    level: 'error',
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    timestamp: new Date().toISOString(),
  }));

  const statusCode = err.status || err.statusCode || 500;
  const message = err.message || 'Erro interno do servidor';

  res.status(statusCode).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    }
  });
});

module.exports = app;
