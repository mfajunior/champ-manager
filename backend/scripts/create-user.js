// Cria um usuário direto no banco, sem passar por rota HTTP nenhuma.
//
// Substitui o antigo POST /api/auth/register: ele foi removido porque este
// sistema tem um único operador (o organizador do campeonato) — não existe
// distinção de papel/role entre usuários, então manter um endpoint público
// de autocadastro só deixava a porta aberta pra qualquer pessoa que
// descobrisse a URL criar uma conta com acesso total ao painel.
//
// Uso:
//   node scripts/create-user.js "seu@email.com" "sua-senha" "Seu Nome"
require('dotenv').config();
const bcryptjs = require('bcryptjs');
const { pool, query } = require('../src/config/database');

async function main() {
  const [, , email, password, ...nameParts] = process.argv;
  const name = nameParts.join(' ');

  if (!email || !password || !name) {
    console.error('Uso: node scripts/create-user.js <email> <senha> <nome>');
    process.exitCode = 1;
    return;
  }
  if (password.length < 6) {
    console.error('A senha precisa ter pelo menos 6 caracteres.');
    process.exitCode = 1;
    return;
  }

  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    console.error(`Já existe um usuário com o email ${email}.`);
    process.exitCode = 1;
    return;
  }

  // Mesmo custo de hash (10) que o antigo authController.register usava —
  // login (authController.login) compara com bcryptjs.compare de qualquer
  // jeito, então o custo só precisa bater com o que compare() espera, não
  // com um valor mágico específico.
  const passwordHash = await bcryptjs.hash(password, 10);
  const result = await query(
    `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name`,
    [email, passwordHash, name]
  );

  console.log('Usuário criado:', result.rows[0]);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
