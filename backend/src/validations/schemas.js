const Joi = require('joi');
const { ALLOWED_SCORING_TYPES } = require('../controllers/workoutController');

/**
 * Um schema por rota de escrita. Nomes seguem controller + ação
 * (championshipCreate, championshipUpdate, ...) para ficar óbvio de onde cada
 * um é usado ao ler as rotas.
 *
 * Os schemas de update usam .min(1): sem isso, um PUT com corpo vazio passaria
 * na validação e cairia direto no controller sem fazer nada — melhor rejeitar
 * na porta de entrada do que silenciosamente não mudar nada.
 */

// tlds: { allow: false } porque o Joi, por padrão, só aceita emails cujo
// domínio termine numa lista fixa de TLDs "reais" — e-mails de teste como
// jest-123@champy.local (usados na suíte de integração) seriam rejeitados
// só por causa do ".local", mesmo sendo um formato de email perfeitamente
// válido. Desligar essa checagem específica não abre mão de validar o
// formato do email (usuário@domínio) — só para de julgar QUAL domínio.
const authLogin = Joi.object({
  email: Joi.string().trim().email({ tlds: { allow: false } }).required(),
  password: Joi.string().required(),
});

/**
 * DATA DE CAMPEONATO É DATA DE CALENDÁRIO, NÃO INSTANTE
 *
 * `championships.date` é DATE no Postgres: "31 de outubro", sem hora e sem
 * fuso. `Joi.date().iso()` parecia a validação certa, mas ela CONVERTE a
 * string num objeto Date do JavaScript — e aí a data deixa de ser calendário
 * e passa a ser instante. O resto do caminho então desloca um dia:
 *
 *   front manda      "2026-10-31"              (<input type="date">)
 *   Joi devolve      2026-10-31T00:00:00.000Z  (meia-noite UTC)
 *   pg serializa     2026-10-30T21:00:00-03:00 (fuso do processo Node)
 *   Postgres grava   2026-10-30                (trunca para DATE)
 *
 * Medido com TZ=America/Sao_Paulo, que é o fuso que o server.js fixa em
 * produção. Ou seja: em qualquer fuso atrás de UTC — o Brasil inteiro — a
 * data gravada é um dia antes da que o organizador digitou. Foi o que
 * aconteceu com o ALTIORA GAMES: cadastrado 31/10, gravado 30/10.
 *
 * A correção é não deixar o Joi construir um Date. Validando como string no
 * formato YYYY-MM-DD, o valor chega ao Postgres como literal de data, que não
 * tem fuso para interpretar errado. É a mesma decisão que lib/format.ts tomou
 * do outro lado (nunca construir Date a partir de uma data de calendário) e
 * que a migration 009 tomou no banco.
 *
 * Efeito colateral intencional: um timestamp completo passa a ser REJEITADO
 * em vez de silenciosamente deslocado. Falhar na porta de entrada é melhor do
 * que gravar o dia errado de um evento.
 */
const dataDeCalendario = Joi.string()
  .trim()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  // O pattern garante o FORMATO, não a existência do dia: "2026-13-45" casa
  // com \d{4}-\d{2}-\d{2} e só estouraria no Postgres, virando 500 em vez do
  // 400 que o cliente merecia. O round-trip por Date.UTC resolve isso — e usa
  // Date apenas como calendário interno, sem nunca devolver o objeto adiante,
  // que é a parte que causava o deslocamento de um dia.
  .custom((valor, helpers) => {
    const [ano, mes, dia] = valor.split('-').map(Number);
    const reconstruida = new Date(Date.UTC(ano, mes - 1, dia));
    const existe =
      reconstruida.getUTCFullYear() === ano &&
      reconstruida.getUTCMonth() === mes - 1 &&
      reconstruida.getUTCDate() === dia;

    return existe ? valor : helpers.error('any.invalid');
  })
  .messages({
    'string.pattern.base': 'date deve estar no formato YYYY-MM-DD',
    'any.invalid': 'date nao e uma data existente no calendario',
  });

const championshipCreate = Joi.object({
  name: Joi.string().trim().min(2).required(),
  date: dataDeCalendario.required(),
  location: Joi.string().trim().min(2).required(),
});

// lanes_per_heat/transition_seconds/start_time: parâmetros globais de agenda
// (ver migration 005) — configurados aqui, não em championshipCreate, porque
// só fazem sentido depois que o organizador sabe quantas raias o box tem.
// pattern HH:mm ou HH:mm:ss porque é isso que um <input type="time"> do
// front manda (HH:mm) e o que o Postgres devolve de volta (HH:mm:ss) — aceitar
// os dois evita ida e volta de formatação só pra validar.
const championshipUpdate = Joi.object({
  name: Joi.string().trim().min(2),
  date: dataDeCalendario,
  location: Joi.string().trim().min(2),
  is_active: Joi.boolean(),
  lanes_per_heat: Joi.number().integer().positive(),
  transition_seconds: Joi.number().integer().min(0),
  start_time: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
}).min(1);

// Os dois atletas da dupla (migration 017). Opcionais e aceitando vazio: as
// equipes cadastradas antes disto não têm nome de atleta, e mandar '' é como a
// tela limpa um campo preenchido por engano.
const nomeDeAtleta = Joi.string().trim().max(255).allow('', null);

const teamCreate = Joi.object({
  championship_id: Joi.number().integer().positive().required(),
  category_id: Joi.number().integer().positive().required(),
  name: Joi.string().trim().min(1).required(),
  athlete_1: nomeDeAtleta,
  athlete_2: nomeDeAtleta,
});

const teamUpdate = Joi.object({
  name: Joi.string().trim().min(1),
  category_id: Joi.number().integer().positive(),
  athlete_1: nomeDeAtleta,
  athlete_2: nomeDeAtleta,
}).min(1);

// scoring_type_2 preenchido = prova com DUAS pontuações independentes
// (migration 014). Cada uma tem a própria colocação e as duas contam no
// placar, então a prova vale o dobro das outras — foi decisão explícita.
// has_tiebreak liga o campo de desempate no lançamento; o desempate ordena
// quem empatou e não aparece no placar.
const workoutCreate = Joi.object({
  championship_id: Joi.number().integer().positive().required(),
  workout_number: Joi.number().integer().positive().required(),
  name: Joi.string().trim().min(1).required(),
  type: Joi.string().trim().allow(null, ''),
  scoring_type: Joi.string().valid(...ALLOWED_SCORING_TYPES),
  scoring_type_2: Joi.string().valid(...ALLOWED_SCORING_TYPES).allow(null),
  has_tiebreak: Joi.boolean(),
});

const workoutUpdate = Joi.object({
  workout_number: Joi.number().integer().positive(),
  name: Joi.string().trim().min(1),
  type: Joi.string().trim().allow(null, ''),
  scoring_type: Joi.string().valid(...ALLOWED_SCORING_TYPES),
  status: Joi.string().trim(),
  description: Joi.string().allow(null, ''),
  // Intervalo depois desta prova, em segundos (migration 013). null remove.
  break_after_seconds: Joi.number().integer().positive().allow(null),
  scoring_type_2: Joi.string().valid(...ALLOWED_SCORING_TYPES).allow(null),
  has_tiebreak: Joi.boolean(),
}).min(1);

// ---------------------------------------------------------------------------
// Tabelas de pontos do modelo points_table (migrations 011 e 012)
// ---------------------------------------------------------------------------

// end_place null = faixa aberta ("desta colocação em diante"). Que a última
// faixa SEJA aberta, que comecem na 1ª colocação e que sejam contínuas é
// verificado pela constraint trigger no banco, não aqui: é validação de
// conjunto, e Joi valida uma faixa de cada vez. Aqui só o formato.
const pointsTableRange = Joi.object({
  start_place: Joi.number().integer().min(1).required(),
  end_place: Joi.number().integer().min(1).allow(null).default(null),
  decrement: Joi.number().integer().min(0).required(),
});

// max(10) é guarda contra payload absurdo, não a regra do produto: a decisão
// foi que a TELA oferece no máximo 3 faixas e o banco suporta N, para afrouxar
// depois ser mudança só de interface. Travar em 3 aqui transformaria a API no
// limite e contrariaria isso.
const pointsTableCreate = Joi.object({
  name: Joi.string().trim().min(2).required(),
  max_points: Joi.number().integer().positive(),
  ranges: Joi.array().items(pointsTableRange).min(1).max(10).required(),
});

// Mandar `ranges` substitui TODAS as faixas — não existe edição individual,
// porque faixas só fazem sentido como conjunto contínuo.
const pointsTableUpdate = Joi.object({
  name: Joi.string().trim().min(2),
  max_points: Joi.number().integer().positive(),
  ranges: Joi.array().items(pointsTableRange).min(1).max(10),
}).min(1);

// Troca do modelo de pontuação do campeonato. confirm existe porque a troca
// reescreve o placar inteiro — mesmo padrão do force ao regerar baterias.
const scoringModelSet = Joi.object({
  scoring_model: Joi.string().valid('legacy', 'points_table').required(),
  points_table_id: Joi.number().integer().positive().allow(null),
  confirm: Joi.boolean().default(false),
});

// Corte da prova. category_id nulo (ou ausente) é a linha padrão, que vale
// para todas as divisões; com categoria, sobrescreve a padrão só naquela.
const workoutCutSet = Joi.object({
  keep_top_n: Joi.number().integer().positive().required(),
  category_id: Joi.number().integer().positive().allow(null).default(null),
});

// Pré-visualização de rascunho: as faixas vão no corpo e nada é salvo.
const pointsTablePreviewDraft = Joi.object({
  max_points: Joi.number().integer().positive(),
  places: Joi.number().integer().positive().max(500),
  ranges: Joi.array().items(pointsTableRange).min(1).max(10).required(),
});

module.exports = {
  pointsTablePreviewDraft,
  scoringModelSet,
  workoutCutSet,
  pointsTableCreate,
  pointsTableUpdate,
  authLogin,
  championshipCreate,
  championshipUpdate,
  teamCreate,
  teamUpdate,
  workoutCreate,
  workoutUpdate,
};
