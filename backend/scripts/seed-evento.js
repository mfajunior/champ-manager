// scripts/seed-evento.js
//
// Cria um campeonato e cadastra as equipes a partir de um arquivo JSON.
//
// POR QUE EXISTE
// Cadastrar 29 equipes pela tela são 29 formulários e 29 chances de errar um
// acento. Pior: o Postgres gratuito do Render expira 30 dias depois de criado,
// então esse cadastro vai precisar ser refeito pelo menos uma vez antes do
// evento. Um arquivo + um comando torna isso reprodutível.
//
// POR QUE OS DADOS FICAM FORA DO GIT
// Nome de equipe de evento real costuma ser nome de pessoa real. O repositório
// é público. O script é genérico e versionado; o arquivo com os participantes
// fica só na máquina (ver .gitignore).
//
// USO
//   cd backend
//   node scripts/seed-evento.js <arquivo.json> "email" "senha"
//
// Para apontar para o backend publicado:
//   SMOKE_BASE_URL=https://... node scripts/seed-evento.js ...

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:5000';

let token = null;

async function api(method, rota, body) {
  const res = await fetch(`${BASE_URL}${rota}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await res.json().catch(() => null);

  if (res.status === 429) {
    throw new Error(
      `${method} ${rota} -> 429 (rate limit)\n` +
        '  O apiLimiter permite 300 requisições por IP a cada 15 minutos.\n' +
        '  Espere a janela expirar ou feche o painel aberto no navegador.'
    );
  }
  if (!res.ok) {
    const erro = payload?.error;
    throw new Error(`${method} ${rota} -> ${res.status} ${erro?.code || ''} ${erro?.message || ''}`);
  }
  return payload;
}

const passo = (t) => console.log(`\n▶ ${t}`);
const ok = (t) => console.log(`  ✓ ${t}`);

async function main() {
  const [, , arquivo, email, senha] = process.argv;

  if (!arquivo || !email || !senha) {
    console.error('Uso: node scripts/seed-evento.js <arquivo.json> "email" "senha"');
    process.exit(1);
  }

  const caminho = path.resolve(arquivo);
  if (!fs.existsSync(caminho)) {
    console.error(`Arquivo não encontrado: ${caminho}`);
    process.exit(1);
  }

  const evento = JSON.parse(fs.readFileSync(caminho, 'utf-8'));

  console.log(`Backend: ${BASE_URL}`);
  console.log(`Arquivo: ${caminho}`);

  passo('Autenticando');
  const login = await api('POST', '/api/auth/login', { email, password: senha });
  token = login.data.token;
  ok(`autenticado como ${login.data.user.name}`);

  passo('Criando campeonato');
  const campeonato = await api('POST', '/api/championships', {
    name: evento.nome,
    date: evento.data,
    location: evento.local,
  });
  const championshipId = campeonato.data.id;
  const categorias = campeonato.data.categories;
  ok(`#${championshipId} "${evento.nome}" em ${evento.data}`);

  // O campeonato nasce com as cinco categorias fixas. O arquivo pode usar
  // qualquer caixa ("SCALE FEMININO", "Scale Feminino"), então a comparação
  // normaliza — e falha alto se o nome não existir, em vez de cadastrar a
  // equipe na categoria errada em silêncio.
  const porNome = new Map(categorias.map((c) => [c.name.toLowerCase().trim(), c]));

  passo('Cadastrando equipes');
  let total = 0;
  for (const [nomeCategoria, equipes] of Object.entries(evento.categorias)) {
    const categoria = porNome.get(nomeCategoria.toLowerCase().trim());
    if (!categoria) {
      throw new Error(
        `Categoria "${nomeCategoria}" não existe neste campeonato.\n` +
          `  Disponíveis: ${categorias.map((c) => c.name).join(', ')}`
      );
    }
    for (const nomeEquipe of equipes) {
      // eslint-disable-next-line no-await-in-loop
      await api('POST', '/api/teams', {
        championship_id: championshipId,
        category_id: categoria.id,
        name: nomeEquipe,
      });
      total += 1;
    }
    ok(`${categoria.name}: ${equipes.length} equipe(s)`);
  }

  console.log(`\n✓ ${total} equipes em ${Object.keys(evento.categorias).length} categorias.`);
  console.log(`  Campeonato #${championshipId}. Provas, agenda e baterias ficam para a tela.`);
}

main().catch((erro) => {
  console.error(`\n✗ ${erro.message}`);
  process.exit(1);
});
