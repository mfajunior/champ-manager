// src/middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

/**
 * Rate limiting só existia como item de checklist no ARCHITECTURE.md antigo —
 * nunca foi implementado de verdade. Sem isso, POST /api/auth/login aceita
 * tentativas de senha ilimitadas vindas do mesmo IP: um script de força bruta
 * rodaria livre contra qualquer email cadastrado.
 *
 * Desligado quando NODE_ENV=test: a suíte de integração faz várias dezenas de
 * chamadas de auth/API em sequência rápida dentro do mesmo processo Jest —
 * não é tráfego real vindo de fora, e aplicar o mesmo limite de produção só
 * quebraria os testes sem ganhar nada em segurança.
 */
const skipInTest = () => process.env.NODE_ENV === 'test';

// O login é o alvo clássico de força bruta e enumeração de email. Limite
// baixo, por IP, só nessa rota — o registro público não existe mais (ver
// routes/auth.js).
//
// "por IP" tem uma ressalva importante em desenvolvimento: acessando pelo
// proxy do Vite (vite.config.ts), toda requisição chega aqui vinda do
// processo do Vite, na mesma máquina, então TODOS os visitantes contam como
// um IP só e dividem o mesmo balde. Numa demo pública (túnel), isso vira o
// primeiro teto a ser atingido, bem antes de qualquer limite de CPU.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Muitas tentativas de autenticação. Tente novamente em alguns minutos.',
    },
  },
});

// Limite geral para o resto da API: mais alto, só para segurar abuso grosseiro
// sem incomodar uso normal (ex.: operador lançando vários resultados seguidos
// durante uma bateria ao vivo).
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Muitas requisições deste IP. Tente novamente em alguns minutos.',
    },
  },
});

module.exports = { authLimiter, apiLimiter };
