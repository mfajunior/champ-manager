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
        '  O apiLimiter permite 3000 requisições por IP a cada 15 minutos.\n' +
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

  if (evento.agenda) {
    passo('Configurando a agenda');
    await api('PUT', `/api/championships/${championshipId}`, {
      lanes_per_heat: evento.agenda.raias,
      transition_seconds: evento.agenda.transicao_segundos,
      start_time: evento.agenda.inicio,
    });
    ok(
      `${evento.agenda.raias} raias, ${evento.agenda.transicao_segundos}s de transição, ` +
        `início ${evento.agenda.inicio}`
    );
  }

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
    // Cada item da categoria pode ser uma string (só o nome da equipe, como
    // sempre foi) ou um objeto { nome, atletas: [a, b] }. Os dois formatos
    // convivem: arquivo antigo continua funcionando sem mudar uma linha.
    for (const item of equipes) {
      const ehObjeto = item !== null && typeof item === 'object';
      const nomeEquipe = ehObjeto ? item.nome : item;
      const atletas = ehObjeto ? item.atletas || [] : [];

      if (!nomeEquipe) {
        throw new Error(
          `Categoria "${categoria.name}": equipe sem nome.\n` +
            '  Use "Nome da equipe" ou { "nome": "...", "atletas": ["...", "..."] }.'
        );
      }

      // eslint-disable-next-line no-await-in-loop
      await api('POST', '/api/teams', {
        championship_id: championshipId,
        category_id: categoria.id,
        name: nomeEquipe,
        ...(atletas[0] ? { athlete_1: atletas[0] } : {}),
        ...(atletas[1] ? { athlete_2: atletas[1] } : {}),
      });
      total += 1;
    }
    ok(`${categoria.name}: ${equipes.length} equipe(s)`);
  }

  let totalProvas = 0;
  let totalVariantes = 0;
  const provasCriadas = [];

  if (evento.provas?.length) {
    passo('Cadastrando provas e variantes');
    for (const prova of evento.provas) {
      // eslint-disable-next-line no-await-in-loop
      const criada = await api('POST', '/api/workouts', {
        championship_id: championshipId,
        workout_number: prova.numero,
        name: prova.nome,
        scoring_type: prova.pontuacao,
        ...(prova.pontuacao_2 ? { scoring_type_2: prova.pontuacao_2 } : {}),
        ...(prova.desempate ? { has_tiebreak: true } : {}),
      });
      const workoutId = criada.data.id;
      provasCriadas.push({ id: workoutId, numero: prova.numero, nome: prova.nome });
      totalProvas += 1;

      // A variante é o que cada categoria de fato executa: mesma prova no
      // cronograma, cargas e movimentos diferentes. O time_cap também é por
      // categoria, e é dele que sai a duração da bateria — o sistema usa o
      // MAIOR cap entre as categorias presentes na mesma bateria.
      let variantes = 0;
      for (const [nomeCategoria, variante] of Object.entries(prova.variantes || {})) {
        const categoria = porNome.get(nomeCategoria.toLowerCase().trim());
        if (!categoria) {
          throw new Error(
            `Prova ${prova.numero}: categoria "${nomeCategoria}" não existe.\n` +
              `  Disponíveis: ${categorias.map((c) => c.name).join(', ')}`
          );
        }
        // eslint-disable-next-line no-await-in-loop
        await api('PUT', `/api/workouts/${workoutId}/variants/${categoria.id}`, {
          description: variante.descricao,
          time_cap_seconds: variante.time_cap_segundos,
        });
        variantes += 1;
        totalVariantes += 1;
      }

      const dupla = prova.pontuacao_2 ? ` + ${prova.pontuacao_2}` : '';
      ok(`Prova ${prova.numero} "${prova.nome}" (${prova.pontuacao}${dupla}): ${variantes} variantes`);
    }
  }

  // --------------------------------------------------------------- PONTUAÇÃO
  // O campeonato nasce em `legacy`, que é o default da coluna no banco. Sem o
  // bloco "pontuacao" no arquivo ele continua assim — comportamento de antes,
  // para não mudar nada por baixo de quem já usa o script. Com o bloco, cria a
  // tabela de pontos e troca o modelo.
  //
  // Vale ligar: foi exatamente isso que faltou no ensaio de 06/10. O
  // campeonato nasceu em legacy, o placar apareceu com coluna "SOMA" em vez de
  // "PONTOS", e só não virou resultado errado porque alguém olhou a tela antes
  // de lançar.
  let resumoPontuacao = 'legacy (soma de colocações)';
  if (evento.pontuacao) {
    passo('Configurando a pontuação');

    const tabela = await api('POST', `/api/championships/${championshipId}/points-tables`, {
      name: evento.pontuacao.nome || 'Tabela do evento',
      max_points: evento.pontuacao.max_pontos,
      ranges: (evento.pontuacao.faixas || []).map((faixa) => ({
        start_place: faixa.inicio,
        end_place: faixa.fim ?? null,
        decrement: faixa.decremento,
      })),
    });

    // confirm: true porque a troca reescreve o placar inteiro. Aqui o
    // campeonato acabou de nascer e não há placar para reescrever, mas o
    // endpoint exige a confirmação explícita de qualquer jeito.
    await api('PUT', `/api/championships/${championshipId}/scoring-model`, {
      scoring_model: 'points_table',
      points_table_id: tabela.data.id,
      confirm: true,
    });

    const faixas = (evento.pontuacao.faixas || [])
      .map((f) => `${f.inicio}-${f.fim ?? '+'}: -${f.decremento}`)
      .join(', ');
    resumoPontuacao = `points_table (${evento.pontuacao.max_pontos} no 1º; ${faixas})`;
    ok(resumoPontuacao);
  }

  // ---------------------------------------------------------------- BATERIAS
  // Desligado por padrão, e isso é decisão e não esquecimento: gerar bateria é
  // decidir ordem e horário, e costuma merecer uma conferida na tela antes de
  // valer. Com "gerar_baterias": true, o seeder gera — o que serve para montar
  // um ambiente de teste inteiro num comando só.
  let totalBaterias = 0;
  if (evento.gerar_baterias && provasCriadas.length) {
    passo('Gerando as baterias');
    for (const prova of provasCriadas) {
      // eslint-disable-next-line no-await-in-loop
      await api('POST', `/api/workouts/${prova.id}/heats`, {});
      // eslint-disable-next-line no-await-in-loop
      const geradas = await api('GET', `/api/workouts/${prova.id}/heats`);
      const porBateria = (geradas.data || []).map((b) => (b.teams || []).length);
      totalBaterias += porBateria.length;
      ok(`Prova ${prova.numero}: ${porBateria.length} baterias (${porBateria.join(',')})`);
    }
  }

  console.log(`\n✓ ${total} equipes, ${totalProvas} provas, ${totalVariantes} variantes.`);
  console.log(`  Campeonato #${championshipId}, pontuação ${resumoPontuacao}.`);
  if (totalBaterias) {
    console.log(`  ${totalBaterias} baterias geradas.`);
  } else {
    console.log('  Falta gerar as baterias — isso fica na tela, porque depende de');
    console.log('  conferir a ordem e o horário antes de valer.');
    console.log('  (Para gerar aqui, ponha "gerar_baterias": true no arquivo.)');
  }
}

main().catch((erro) => {
  console.error(`\n✗ ${erro.message}`);
  process.exit(1);
});
