// Sincroniza as equipes de um campeonato JÁ EXISTENTE com um arquivo de evento.
//
// POR QUE NÃO APAGAR E RECRIAR
// A pergunta natural, quando o arquivo ganha dados novos (os atletas da dupla),
// é apagar as equipes e cadastrar de novo. Sai caro: results aponta para
// heat_teams, que aponta para teams, então apagar uma equipe leva em cascata a
// atribuição de raia e qualquer resultado lançado. As baterias precisariam ser
// regeradas e os ids das equipes mudariam — e id de equipe é o que o placar
// usa para expandir o histórico por prova.
//
// Este script compara arquivo e banco, casa as equipes por NOME dentro da
// CATEGORIA, e só manda PUT /api/teams/:id no que está diferente. Equipe que
// já está correta não recebe requisição nenhuma.
//
// POR QUE CASAR POR NOME E NÃO POR ORDEM
// Ordem do JSON parece suficiente e não é: basta alguém reordenar o arquivo, ou
// cadastrar uma equipe pela tela, para a posição 7 do arquivo virar outra equipe
// no banco. O nome é o que o organizador reconhece, e a comparação ignora caixa
// e acento, para "Sabor RX" casar com "Sabor Rx" — justamente a divergência que
// aparece quando a lista vem copiada de uma planilha.
//
// SECO POR PADRÃO
// Sem --aplicar, o script só IMPRIME o que faria. Isso é de propósito: este
// script escreve no campeonato que o cliente acessa, e a conferência das 29
// equipes é mais barata lendo o plano do que desfazendo na tela.
//
// USO
//   cd backend
//   node scripts/sincronizar-equipes.js <arquivo.json> "email" "senha"            # lista os campeonatos
//   node scripts/sincronizar-equipes.js <arquivo.json> "email" "senha" 5          # plano, sem escrever
//   node scripts/sincronizar-equipes.js <arquivo.json> "email" "senha" 5 --aplicar
//
// Para apontar para o backend publicado:
//   SMOKE_BASE_URL=https://... node scripts/sincronizar-equipes.js ...

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
  if (!res.ok) {
    const erro = payload?.error;
    throw new Error(`${method} ${rota} -> ${res.status} ${erro?.code || ''} ${erro?.message || ''}`);
  }
  return payload;
}

// Ignora caixa, acento e pontuação: o mesmo nome digitado em dois lugares
// diferentes raramente volta idêntico.
const chave = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const vazioEhNulo = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

async function main() {
  const [, , arquivo, email, senha, idArg, ...flags] = process.argv;
  const aplicar = flags.includes('--aplicar');

  if (!arquivo || !email || !senha) {
    console.error('Uso: node scripts/sincronizar-equipes.js <arquivo.json> "email" "senha" [championship_id] [--aplicar]');
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

  const login = await api('POST', '/api/auth/login', { email, password: senha });
  token = login.data.token;
  console.log(`Autenticado como ${login.data.user.name}\n`);

  if (!idArg) {
    const lista = await api('GET', '/api/championships');
    console.log('Campeonatos neste backend (passe o id como 4º argumento):');
    for (const c of lista.data) {
      console.log(`  #${c.id}  ${c.date}  ${c.name}`);
    }
    return;
  }

  const championshipId = Number(idArg);
  const campeonato = await api('GET', `/api/championships/${championshipId}`);
  console.log(`Campeonato #${championshipId}: "${campeonato.data.name}" (${campeonato.data.date})`);
  console.log(`Modelo de pontuação: ${campeonato.data.scoring_model}`);

  const atuais = (await api('GET', `/api/teams?championship_id=${championshipId}`)).data;
  const porCategoria = new Map();
  for (const t of atuais) {
    if (!porCategoria.has(chave(t.category_name))) porCategoria.set(chave(t.category_name), []);
    porCategoria.get(chave(t.category_name)).push(t);
  }

  const planoDeMudanca = [];
  const naoEncontradas = [];
  const jaCorretas = [];
  const casadas = new Set();

  for (const [nomeCategoria, equipes] of Object.entries(evento.categorias)) {
    const noBanco = porCategoria.get(chave(nomeCategoria)) || [];
    for (const item of equipes) {
      const ehObjeto = item !== null && typeof item === 'object';
      const nomeArquivo = ehObjeto ? item.nome : item;
      const atletas = ehObjeto ? item.atletas || [] : [];

      const alvo = noBanco.find((t) => chave(t.name) === chave(nomeArquivo));
      if (!alvo) {
        naoEncontradas.push(`${nomeCategoria} · "${nomeArquivo}"`);
        continue;
      }
      casadas.add(alvo.id);

      const corpo = {};
      if (alvo.name !== nomeArquivo) corpo.name = nomeArquivo;
      const a1 = vazioEhNulo(atletas[0]);
      const a2 = vazioEhNulo(atletas[1]);
      if (a1 !== null && alvo.athlete_1 !== a1) corpo.athlete_1 = a1;
      if (a2 !== null && alvo.athlete_2 !== a2) corpo.athlete_2 = a2;

      if (Object.keys(corpo).length === 0) {
        jaCorretas.push(`${alvo.name}`);
      } else {
        planoDeMudanca.push({ id: alvo.id, categoria: alvo.category_name, de: alvo, corpo });
      }
    }
  }

  // Equipe que existe no banco e NÃO está no arquivo. O script não apaga nada:
  // avisa e deixa a decisão para quem está olhando, porque pode ser inscrição
  // de última hora feita pela tela — e apagar seria destrutivo e silencioso.
  const sobrando = atuais.filter((t) => !casadas.has(t.id));

  console.log(`\n${atuais.length} equipes no banco, ${Object.values(evento.categorias).flat().length} no arquivo\n`);

  if (planoDeMudanca.length) {
    console.log(`A MUDAR (${planoDeMudanca.length}):`);
    for (const p of planoDeMudanca) {
      const partes = [];
      if (p.corpo.name) partes.push(`nome: "${p.de.name}" -> "${p.corpo.name}"`);
      if (p.corpo.athlete_1) partes.push(`atleta 1: ${p.de.athlete_1 ?? '(vazio)'} -> ${p.corpo.athlete_1}`);
      if (p.corpo.athlete_2) partes.push(`atleta 2: ${p.de.athlete_2 ?? '(vazio)'} -> ${p.corpo.athlete_2}`);
      console.log(`  #${p.id} [${p.categoria}] ${p.de.name}`);
      for (const parte of partes) console.log(`         ${parte}`);
    }
  }
  if (jaCorretas.length) console.log(`\nJÁ CORRETAS (${jaCorretas.length}): ${jaCorretas.join(', ')}`);
  if (naoEncontradas.length) {
    console.log(`\nNO ARQUIVO MAS NÃO NO BANCO (${naoEncontradas.length}) — nenhuma equipe será criada:`);
    for (const n of naoEncontradas) console.log(`  ${n}`);
  }
  if (sobrando.length) {
    console.log(`\nNO BANCO MAS NÃO NO ARQUIVO (${sobrando.length}) — nada será apagado:`);
    for (const s of sobrando) console.log(`  #${s.id} [${s.category_name}] ${s.name}`);
  }

  if (!aplicar) {
    console.log('\n--- NADA FOI ESCRITO. Repita com --aplicar para gravar. ---');
    return;
  }

  if (!planoDeMudanca.length) {
    console.log('\nNada a aplicar.');
    return;
  }

  console.log(`\nAplicando ${planoDeMudanca.length} alteração(ões)...`);
  let feitas = 0;
  for (const p of planoDeMudanca) {
    // eslint-disable-next-line no-await-in-loop
    await api('PUT', `/api/teams/${p.id}`, p.corpo);
    feitas += 1;
    console.log(`  ✓ #${p.id} ${p.corpo.name || p.de.name}`);
  }
  console.log(`\n${feitas} equipe(s) atualizada(s).`);
}

main().catch((err) => {
  console.error(`\nFalhou: ${err.message}`);
  process.exit(1);
});
