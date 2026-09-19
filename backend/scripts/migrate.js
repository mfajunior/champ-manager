// scripts/migrate.js
//
// Roda as migrations de migrations/*.sql, em ordem alfabética (001, 002,
// 003...), direto pelo Node — sem precisar do cliente `psql` instalado na
// máquina.
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
// CONTROLE DE MIGRATIONS JÁ APLICADAS (schema_migrations)
// Até a migration 004, cada arquivo era responsável por ser idempotente
// sozinho (CREATE TABLE IF NOT EXISTS, DROP ... IF EXISTS antes de ADD, etc.)
// porque rodar tudo de novo por engano não podia duplicar dado. Isso quebrou
// na prática duas vezes: a migration 002 tinha um ADD CONSTRAINT sem o DROP
// IF EXISTS correspondente (corrigida depois de causar um bug real), e a
// migration 005 apaga uma coluna (heats.category_id) que uma migration
// ANTERIOR (002) usa pra criar um índice — rodar tudo de novo depois que a
// 005 já rodou uma vez quebra a 002, porque a tabela `heats` já existe sem
// aquela coluna e o `CREATE TABLE IF NOT EXISTS` da 001 não a recria.
//
// A causa raiz das duas vezes é a mesma: nunca houve registro de QUAIS
// arquivos já rodaram, então "rodar de novo" sempre significava "rodar TUDO
// de novo". A tabela schema_migrations resolve isso na raiz — cada arquivo
// roda exatamente uma vez, para sempre, então uma migration não precisa mais
// sobreviver a ser reexecutada depois que uma migration futura muda o que ela
// mexeu. As migrations 001-004 continuam idempotentes (não custa nada manter
// essa garantia), mas deixam de DEPENDER disso pra funcionar.
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const ensureMigrationsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

const getAppliedMigrations = async () => {
  const result = await pool.query('SELECT filename FROM schema_migrations');
  return new Set(result.rows.map((row) => row.filename));
};

const run = async () => {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // nomes começam com 001, 002... — ordem alfabética já é a ordem certa

  if (files.length === 0) {
    console.log(`Nenhum arquivo .sql encontrado em ${MIGRATIONS_DIR}`);
    return;
  }

  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log(`Nenhuma migration pendente — banco já está atualizado (${files.length} aplicada(s)).`);
    return;
  }

  console.log(`${pending.length} migration(s) pendente(s) de ${files.length} no total.\n`);

  for (const file of pending) {
    const fullPath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    process.stdout.write(`Aplicando ${file}... `);
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    console.log('OK');
  }

  console.log('\nTodas as migrations pendentes foram aplicadas.');
};

run()
  .catch((err) => {
    console.error('\nFalha ao rodar migrations:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
