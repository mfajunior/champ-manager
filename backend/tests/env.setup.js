const path = require('path');

// Precisa rodar ANTES de qualquer require de src/config/database.js: o Pool do
// pg lê process.env no momento em que o módulo é carregado, então se o .env.test
// entrasse depois, os testes de integração acabariam usando o banco de
// desenvolvimento (ou pior, escrevendo nele) sem ninguém perceber.
require('dotenv').config({ path: path.join(__dirname, '..', '.env.test') });
