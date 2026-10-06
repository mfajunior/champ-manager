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

// Limite geral para o resto da API.
//
// POR QUE 3000 E NÃO 300
//
// O 300 foi calibrado contra um atacante, e o atacante não é mais o cenário
// que aperta primeiro. Dois fatos mudaram a conta:
//
// 1. Limite é por IP, e a plateia de um evento sai toda pelo mesmo wi-fi do
//    box — um IP só atrás do NAT do roteador. Cinquenta pessoas são "uma
//    pessoa" para este limitador, mesmo com trust proxy configurado certo.
// 2. Medido em produção: um passeio pelas telas públicas gasta ~60
//    requisições contadas. Com 300, cinco espectadores curiosos em 15
//    minutos esvaziam o balde.
//
// E o balde é compartilhado com quem escreve: o limitador está montado em
// todo o /api (app.js), então a plateia estourando o limite derruba o
// organizador lançando resultado no meio da prova. Esse é o custo real.
//
// A superfície que este limitador defende é a NÃO autenticada — toda rota de
// escrita já está atrás do authMiddleware, e o login tem o authLimiter, bem
// mais apertado, logo abaixo. Sobra uma plateia anônima lendo placar público,
// onde não há o que roubar. Daí ser generoso.
//
// Generoso, não removido: 3000 ainda segura um loop de refetch com bug ou um
// scraper bobo antes que eles pendurem os 0.1 de CPU do plano gratuito.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
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
