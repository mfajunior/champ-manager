// src/app.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

/**
 * Express App Setup
 * Configura middlewares de segurança, CORS e roteamento
 */
const app = express();

// ============= MIDDLEWARES DE SEGURANÇA =============
app.use(helmet()); // Headers de segurança HTTP
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));

// ============= BODY PARSERS =============
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ============= LOGGING =============
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} [${res.statusCode}] ${duration}ms`);
  });
  next();
});

// ============= HEALTH CHECK =============
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
  });
});

// ============= ROTAS (será preenchido depois) =============

// Placeholder de rotas - serão importadas quando implementadas
// app.use('/api/auth', require('./routes/auth'));
// app.use('/api/teams', require('./routes/teams'));
// app.use('/api/workouts', require('./routes/workouts'));
// app.use('/api/results', require('./routes/results'));
// app.use('/api/leaderboard', require('./routes/leaderboard'));

// ============= ERROR HANDLING =============
/**
 * Middleware de erro centralizado
 * Captura erros de todas as rotas e retorna resposta padronizada
 */
app.use((err, req, res, next) => {
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  const statusCode = err.status || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: {
      message,
      status: statusCode,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
});

// ============= 404 HANDLER =============
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Route not found',
      path: req.path,
      method: req.method,
    },
  });
});

module.exports = app;
