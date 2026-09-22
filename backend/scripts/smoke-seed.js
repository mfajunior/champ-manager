// scripts/smoke-seed.js
//
// Popula um campeonato de teste com volume realista e confere o resultado.
// Substitui os antigos smoke-test*.ps1 (removidos: chamavam a rota de
// registro, que não existe mais, e mandavam parâmetros de bateria que
// sumiram na migration 005).
//
// O QUE ELE MONTA
//   - 1 campeonato novo, com nome datado (não toca em nada já existente)
//   - 60 equipes distribuídas de forma DESIGUAL entre as 5 categorias
//     padrão — 18/12/15/9/6. Distribuição uniforme esconde bug: com todas
//     as categorias do mesmo tamanho, a última bateria de cada uma fecha
//     redondo e o preenchimento entre categorias nunca é exercitado.
//   - 3 provas, uma de cada scoring_type: FOR TIME ('time', menor vence),
//     AMRAP ('reps', maior vence) e PR de carga ('load', maior vence)
//   - variantes por categoria com time cap diferente (iniciante tem mais
//     tempo que RX) — sem time cap, a agenda não calcula horário nenhum
//   - baterias geradas por prova e um resultado aleatório em cada raia,
//     com ~4% de WO
//
// POR QUE VIA HTTP, E NÃO INSERT DIRETO NO BANCO
// Inserir direto seria mais rápido, mas não provaria nada: passaria por
// fora das validações, do cálculo de colocação (trigger), do recálculo de
// standings e do broadcast do WebSocket. Falando pela API, cada resultado
// lançado percorre o mesmo caminho de um evento real — e é por isso que o
// script também serve como medida de carga: 180 resultados lançados em
// sequência, cada um disparando recalculate_placements +
// recalculate_standings do campeonato inteiro.
//
// USO
//   cd backend
//   node scripts/smoke-seed.js "seu@email.com" "sua-senha"
//
// A conta precisa existir (npm run create-user). Para apontar para outro
// backend: SMOKE_BASE_URL=http://host:porta node scripts/smoke-seed.js ...
//
// ATENÇÃO: cria dados de verdade no banco que o backend estiver usando.
// Rode contra desenvolvimento. O campeonato criado fica identificado como
// "[SMOKE]" e pode ser arquivado ou excluído pelo painel depois.

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:5000';

// 18 + 12 + 15 + 9 + 6 = 60. Proposital que nenhuma seja múltiplo de 8
// (as raias configuradas abaixo): garante bateria incompleta e mistura de
// categorias na mesma bateria, que é o caminho que a migration 005 abriu.
const DISTRIBUICAO = {
  'Iniciante Masculino': 18,
  'Iniciante Feminino': 12,
  'Scale Masculino': 15,
  'Scale Feminino': 9,
  'RX Misto': 6,
};

const LANES_PER_HEAT = 8;
const TRANSITION_SECONDS = 120;
const START_TIME = '08:00';

// time_cap por nível: quem escala mais pesado termina mais rápido.
const TIME_CAP_POR_NIVEL = { iniciante: 900, scale: 720, rx: 600 };

const PROVAS = [
  {
    workout_number: 1,
    name: 'Fran adaptada',
    scoring_type: 'time',
    descricao: (cat) => `21-15-9 thrusters + pull-ups (${cat.name})`,
  },
  {
    workout_number: 2,
    name: 'AMRAP 12 - Cindy',
    scoring_type: 'reps',
    descricao: (cat) => `AMRAP 12min: 5 pull-ups, 10 push-ups, 15 air squats (${cat.name})`,
  },
  {
    workout_number: 3,
    name: 'Clean & Jerk 1RM',
    scoring_type: 'load',
    descricao: (cat) => `Encontrar a carga máxima em clean & jerk (${cat.name})`,
  },
];

const PROB_WO = 0.04;

const inteiroEntre = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Valor coerente com o tipo de pontuação. Faixas escolhidas pra render
// ranking disputado (muitos valores próximos) em vez de números aleatórios
// espalhados demais, onde empate e desempate nunca aconteceriam.
const valorAleatorio = (scoringType) => {
  if (scoringType === 'time') return inteiroEntre(180, 600); // segundos
  if (scoringType === 'reps') return inteiroEntre(180, 380);
  return inteiroEntre(16, 56) * 2.5; // kg, em múltiplos de 2.5
};

let token = null;

async function api(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
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
    throw new Error(`${method} ${path} -> ${res.status} ${erro?.code || ''} ${erro?.message || ''}`);
  }
  return payload;
}

const passo = (texto) => console.log(`\n▶ ${texto}`);
const ok = (texto) => console.log(`  ✓ ${texto}`);
const falha = (texto) => console.log(`  ✗ ${texto}`);

async function main() {
  const [, , email, senha] = process.argv;

  if (!email || !senha) {
    console.error('Uso: node scripts/smoke-seed.js <email> <senha>');
    console.error('A conta precisa existir — crie com: npm run create-user -- "email" "senha" "Nome"');
    process.exitCode = 1;
    return;
  }

  console.log(`Alvo: ${BASE_URL}`);

  passo('Login');
  const login = await api('POST', '/api/auth/login', { email, password: senha });
  token = login.data.token;
  ok(`autenticado como ${login.data.user.name}`);

  passo('Criando campeonato');
  const agora = new Date();
  const carimbo = agora.toISOString().slice(0, 16).replace('T', ' ');
  const campeonato = await api('POST', '/api/championships', {
    name: `[SMOKE] 60 equipes - ${carimbo}`,
    date: agora.toISOString().slice(0, 10),
    location: 'Box de teste',
  });
  const championshipId = campeonato.data.id;
  const categorias = campeonato.data.categories;
  ok(`campeonato #${championshipId} com ${categorias.length} categorias`);

  passo('Configurando agenda');
  await api('PUT', `/api/championships/${championshipId}`, {
    lanes_per_heat: LANES_PER_HEAT,
    transition_seconds: TRANSITION_SECONDS,
    start_time: START_TIME,
  });
  ok(`${LANES_PER_HEAT} raias, ${TRANSITION_SECONDS}s de transição, início ${START_TIME}`);

  passo('Cadastrando 60 equipes (distribuição desigual)');
  let totalEquipes = 0;
  for (const categoria of categorias) {
    const quantas = DISTRIBUICAO[categoria.name] ?? 0;
    for (let i = 1; i <= quantas; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await api('POST', '/api/teams', {
        championship_id: championshipId,
        category_id: categoria.id,
        name: `${categoria.name.split(' ')[0]} Team ${String(i).padStart(2, '0')}`,
      });
      totalEquipes += 1;
    }
    ok(`${categoria.name}: ${quantas} equipes`);
  }

  passo('Criando 3 provas e as variantes por categoria');
  const provas = [];
  for (const prova of PROVAS) {
    // eslint-disable-next-line no-await-in-loop
    const criada = await api('POST', '/api/workouts', {
      championship_id: championshipId,
      workout_number: prova.workout_number,
      name: prova.name,
      scoring_type: prova.scoring_type,
    });
    provas.push({ ...prova, id: criada.data.id });

    for (const categoria of categorias) {
      // eslint-disable-next-line no-await-in-loop
      await api('PUT', `/api/workouts/${criada.data.id}/variants/${categoria.id}`, {
        description: prova.descricao(categoria),
        time_cap_seconds: TIME_CAP_POR_NIVEL[categoria.level] ?? 600,
      });
    }
    ok(`${prova.name} (${prova.scoring_type}) + ${categorias.length} variantes`);
  }

  passo('Gerando baterias');
  for (const prova of provas) {
    // eslint-disable-next-line no-await-in-loop
    const geradas = await api('POST', `/api/workouts/${prova.id}/heats`, {});
    ok(`${prova.name}: ${geradas.meta.heatsCreated} baterias para ${geradas.meta.totalTeams} equipes`);
  }

  passo('Lançando resultados aleatórios');
  const duracoes = [];
  let lancados = 0;
  let wos = 0;

  for (const prova of provas) {
    // eslint-disable-next-line no-await-in-loop
    const baterias = await api('GET', `/api/workouts/${prova.id}/heats`);

    for (const bateria of baterias.data) {
      for (const raia of bateria.teams) {
        const isWo = Math.random() < PROB_WO;
        const corpo = isWo
          ? { heat_team_id: raia.heat_team_id, did_not_finish: true }
          : { heat_team_id: raia.heat_team_id, raw_value: valorAleatorio(prova.scoring_type) };

        const inicio = Date.now();
        // eslint-disable-next-line no-await-in-loop
        await api('POST', '/api/results', corpo);
        duracoes.push(Date.now() - inicio);

        lancados += 1;
        if (isWo) wos += 1;
      }
    }
    ok(`${prova.name}: resultados lançados`);
  }

  duracoes.sort((a, b) => a - b);
  const media = Math.round(duracoes.reduce((s, d) => s + d, 0) / duracoes.length);
  const p95 = duracoes[Math.floor(duracoes.length * 0.95)];
  ok(`${lancados} resultados (${wos} WO) — média ${media}ms, p95 ${p95}ms, pior ${duracoes.at(-1)}ms`);

  // ==========================================================================
  // Verificação: a parte "smoke" de verdade. Sem isso o script só populava
  // o banco — aqui ele confere que o que saiu do outro lado faz sentido.
  // ==========================================================================
  passo('Verificando');
  let erros = 0;

  const leaderboard = await api('GET', `/api/leaderboard?championship_id=${championshipId}`);
  const linhas = leaderboard.data;

  if (linhas.length === totalEquipes) ok(`leaderboard traz as ${totalEquipes} equipes`);
  else { falha(`leaderboard traz ${linhas.length} linhas, esperado ${totalEquipes}`); erros += 1; }

  const semPlace = linhas.filter((l) => l.place === null);
  if (semPlace.length === 0) ok('toda equipe tem colocação calculada');
  else { falha(`${semPlace.length} equipe(s) sem place — o trigger não rodou para elas`); erros += 1; }

  // Colocação é por categoria (migration 002): dentro de cada uma, a
  // sequência precisa começar em 1 e não ter buraco.
  const porCategoria = linhas.reduce((acc, l) => {
    (acc[l.category_name] ||= []).push(l.place);
    return acc;
  }, {});

  for (const [nome, places] of Object.entries(porCategoria)) {
    const ordenados = [...places].sort((a, b) => a - b);
    const esperado = ordenados.map((_, i) => i + 1);
    const igual = ordenados.every((p, i) => p === esperado[i]);
    if (igual) ok(`${nome}: colocações 1..${ordenados.length} sem buraco`);
    else { falha(`${nome}: sequência inesperada -> ${ordenados.join(', ')}`); erros += 1; }
  }

  // total_score é a soma das colocações nas 3 provas: o mínimo possível é
  // 3 (primeiro em tudo) e o máximo é 3 × tamanho da categoria.
  const foraDeFaixa = linhas.filter((l) => {
    const tamanho = porCategoria[l.category_name].length;
    return l.total_score < provas.length || l.total_score > provas.length * tamanho;
  });
  if (foraDeFaixa.length === 0) ok('total_score dentro da faixa possível para 3 provas');
  else { falha(`${foraDeFaixa.length} equipe(s) com total_score fora da faixa`); erros += 1; }

  const comTresProvas = linhas.filter((l) => l.workouts_completed === provas.length);
  if (comTresProvas.length === totalEquipes) ok('toda equipe pontuou nas 3 provas');
  else { falha(`${totalEquipes - comTresProvas.length} equipe(s) com menos de 3 provas`); erros += 1; }

  console.log('\n' + '─'.repeat(60));
  if (erros === 0) {
    console.log(`Tudo certo. Campeonato #${championshipId} pronto para inspeção visual.`);
  } else {
    console.log(`${erros} verificação(ões) falharam. Campeonato #${championshipId} ficou no banco para investigar.`);
    process.exitCode = 1;
  }
  console.log(`Placar público: ${BASE_URL.replace(':5000', ':3000')}/placar/${championshipId}`);
  console.log(`Painel:         ${BASE_URL.replace(':5000', ':3000')}/admin/campeonatos/${championshipId}`);
  console.log('Para limpar depois: arquive ou exclua esse campeonato pelo painel.');
}

main().catch((err) => {
  console.error('\n✗ Falhou:', err.message);
  process.exitCode = 1;
});
