const path = require('path');

// Precisa rodar ANTES de qualquer require de src/config/database.js: o Pool do
// pg lê process.env no momento em que o módulo é carregado, então se o .env.test
// entrasse depois, os testes de integração acabariam usando o banco de
// desenvolvimento (ou pior, escrevendo nele) sem ninguém perceber.
require('dotenv').config({ path: path.join(__dirname, '..', '.env.test') });

// Silencia o log de query durante os testes.
//
// .env.test não define LOG_LEVEL, mas os módulos de src/ chamam
// require('dotenv').config() sem path — o que carrega backend/.env, o de
// DESENVOLVIMENTO, e traz de lá LOG_LEVEL=debug. O efeito é cada teste
// despejando o SQL inteiro no console: o "93 passed" acaba enterrado sob
// centenas de linhas, e uma falha de verdade passa despercebida no meio.
//
// dotenv nunca sobrescreve uma chave já presente em process.env, então
// definir a chave aqui (mesmo vazia) basta pra barrar o valor de dev. O IF
// preserva um override explícito: LOG_LEVEL=debug npm test continua
// mostrando as queries quando você quiser depurar uma execução específica.
if (!process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = '';
}
