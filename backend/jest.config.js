module.exports = {
  testEnvironment: 'node',
  // Carrega o .env.test ANTES de qualquer módulo (inclusive src/config/database.js)
  // ser exigido — é o que garante que os testes rodam contra
  // champy_championship_test, nunca contra o banco de desenvolvimento.
  setupFiles: ['<rootDir>/tests/env.setup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  // Cada arquivo de integração cria seu próprio campeonato (nome e email únicos
  // por timestamp+random) e só enxerga linhas com o championship_id dele —
  // arquivos diferentes nunca disputam a mesma linha, então não há motivo pra
  // travar tudo num worker só. maxWorkers ficou de propósito sem valor fixo
  // aqui: o Jest decide sozinho com base nos núcleos disponíveis (na máquina
  // local ou no runner do CI), e isso já foi validado rodando a suíte várias
  // vezes seguidas sem nenhuma falha intermitente antes de tirar o limite.
  //
  // O que TEM que continuar em série é dentro do MESMO arquivo, entre testes
  // que leem/escrevem o mesmo campeonato — isso o Jest já garante sozinho
  // (testes de um arquivo sempre rodam em ordem, nunca em paralelo entre si).
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js', // só bootstrap (listen, shutdown) — não tem branch pra cobrir
  ],
  coverageDirectory: 'coverage',
};
