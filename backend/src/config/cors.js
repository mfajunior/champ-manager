// src/config/cors.js
//
// CORS_ORIGIN aceita uma lista separada por vírgula, não só uma origem única.
// Motivo: o mesmo frontend em dev roda em pelo menos duas origens diferentes —
// http://localhost:3000 (o próprio PC) e http://<IP-da-rede>:3000 (quando
// alguém abre pelo celular na mesma Wi-Fi, pra ver o placar ao vivo no
// telefone). Com origin fixo, a segunda sempre cai em erro de CORS — o
// navegador bloqueia a resposta antes mesmo dela chegar no app React.
//
// Usado tanto pelo cors() do Express (app.js) quanto pela config do
// Socket.io (socket.js) — as duas aceitam "origin" como função, então a
// mesma lógica de checagem serve para as duas, sem duplicar a lista.

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Função no formato que tanto o pacote `cors` quanto o `socket.io` esperam:
 * (origin, callback) => callback(erro, permitido).
 *
 * `origin` vem undefined em requisições sem header Origin (curl, apps
 * mobile nativos, health check de infra) — essas são liberadas, porque não
 * há navegador nenhum aplicando política de CORS ali; bloquear teria efeito
 * zero em segurança e só quebraria ferramentas legítimas.
 */
const corsOriginChecker = (origin, callback) => {
  if (!origin || allowedOrigins.includes(origin)) {
    callback(null, true);
    return;
  }
  callback(new Error(`Origem não permitida pelo CORS: ${origin}`));
};

module.exports = { allowedOrigins, corsOriginChecker };
