// scripts/migrate.js
//
// Roda todas as migrations de migrations/*.sql, em ordem alfabética (001,
// 002, 003...), direto pelo Node — sem precisar do cliente `psql` instalado
// na máquina.
//
// CONTEXTO
// Até agora o único jeito documentado de migrar era `docker compose exec
// postgres psql ...`, o que só existe rodando o Postgres local via Docker.
// Bancos hospedados (Neon, Render Postgres) não têm um container pra entrar
// com `docker compose exec` — e o Windows não vem com `psql` instalado por
// padrão. Este script usa a mesma conexão `pg` que o backend já usa
// (config/database.js), então funciona contra QUALQUER Postgres que as
// variáveis de ambiente apontarem — local, Docker ou hospedado — bastando
// trocar o .env antes de rodar.
//
// Uso:
//   cd backend
//   npm run migrate
//
// Não existe uma tabela de "migrations já aplicadas" (schema_migrations):
// as próprias migrations usam CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT
// EXISTS, então rodar tudo de novo por engano não duplica dado — mas também
// não há como saber por aqui o que já rodou antes. Quem decide isso é você.
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const run = async () => {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // nomes começam com 001, 002... — ordem alfabética já é a ordem certa

  if (files.length === 0) {
    console.log(`Nenhum arquivo .sql encontrado em ${MIGRATIONS_DIR}`);
    return;
  }

  console.log(`Encontradas ${files.length} migrations em ${MIGRATIONS_DIR}\n`);

  for (const file of files) {
    const fullPath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    process.stdout.write(`Aplicando ${file}... `);
    await pool.query(sql);
    console.log('OK');
  }

  console.log('\nTodas as migrations foram aplicadas.');
};

run()
  .catch((err) => {
    console.error('\nFalha ao rodar migrations:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
