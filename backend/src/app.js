const express = require('express');
const cors = require('cors');
const { corsOriginChecker } = require('./config/cors');
const helmet = require('helmet');
require('dotenv').config();

const { apiLimiter } = require('./middleware/rateLimiter');

const app = express();

// Render (e a maioria dos PaaS — Railway, Heroku, Fly.io) coloca um proxy na
// frente da aplicação: toda requisição chega internamente vinda do proxy,
// com o IP real do visitante só no header X-Forwarded-For. Sem "trust
// proxy", o Express ignora esse header — req.ip vira sempre o IP do proxy
// para QUALQUER visitante. Na prática (testado direto): o express-rate-limit
// não quebra a requisição por causa disso, mas os logs enchem de
// ValidationError a cada request, e o pior — o limite de tentativas de
// login passa a ser um balde só, compartilhado por todo mundo que loga
// (porque todo mundo "é" o mesmo IP aparente). Ou seja: um único
// atacante errando a senha 10 vezes tranca o login de qualquer pessoa por
// 15 minutos, não só o dele.
//
// A correção óbvia seria ligar "trust proxy" sempre — mas SÓ é seguro fazer
// isso quando o Express não pode ser alcançado de nenhum outro jeito a não
// ser através desse proxy confiável. Isso é verdade no Render (a rede deles
// isola o container; só chega tráfego vindo do proxy deles). NÃO é verdade
// rodando local ou exposto na rede Wi-Fi (como fizemos para acessar pelo
// celular): ali o Express está diretamente alcançável, e ligar "trust
// proxy" deixaria qualquer aparelho na mesma rede forjar esse header e
// furar o rate limit do login sozinho — testei isso também: com "trust
// proxy" sempre ligado, um curl com X-Forwarded-For diferente a cada
// tentativa passa batido pelo limite. Por isso a checagem por NODE_ENV: só
// confia no header quando NODE_ENV=production (valor que só é setado no
// Render — dev e a rede local continuam com o Express usando o IP real da
// conexão, sem depender de header nenhum).
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ==================== MIDDLEWARE ====================

// Security
app.use(helmet());
app.use(cors({
  origin: corsOriginChecker,
  credentials: true,
}));

// Rate limiting geral da API — desligado em teste (ver middleware/rateLimiter.js).
// authLimiter, mais restrito, é aplicado só em /api/auth (routes/auth.js).
app.use('/api', apiLimiter);

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
