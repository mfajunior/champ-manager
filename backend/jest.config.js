module.exports = {
  testEnvironment: 'node',
  // Carrega o .env.test ANTES de qualquer módulo (inclusive src/config/database.js)
  // ser exigido — é o que garante que os testes rodam contra
  // champy_championship_test, nunca contra o banco de desenvolvimento.
  setupFiles: ['<rootDir>/tests/env.setup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  // As tabelas ficam com dados de teste entre execuções de propósito
  // (ver tests/README.md); rodar em série evita duas suítes de integração
  // disputando o mesmo campeonato ao mesmo tempo.
  maxWorkers: 1,
};
