// src/validations/schemas.js
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

const championshipCreate = Joi.object({
  name: Joi.string().trim().min(2).required(),
  date: Joi.date().iso().required(),
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
  date: Joi.date().iso(),
  location: Joi.string().trim().min(2),
  is_active: Joi.boolean(),
  lanes_per_heat: Joi.number().integer().positive(),
  transition_seconds: Joi.number().integer().min(0),
  start_time: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
}).min(1);

const teamCreate = Joi.object({
  championship_id: Joi.number().integer().positive().required(),
  category_id: Joi.number().integer().positive().required(),
  name: Joi.string().trim().min(1).required(),
});

const teamUpdate = Joi.object({
  name: Joi.string().trim().min(1),
  category_id: Joi.number().integer().positive(),
}).min(1);

const workoutCreate = Joi.object({
  championship_id: Joi.number().integer().positive().required(),
  workout_number: Joi.number().integer().positive().required(),
  name: Joi.string().trim().min(1).required(),
  type: Joi.string().trim().allow(null, ''),
  scoring_type: Joi.string().valid(...ALLOWED_SCORING_TYPES),
});

const workoutUpdate = Joi.object({
  workout_number: Joi.number().integer().positive(),
  name: Joi.string().trim().min(1),
  type: Joi.string().trim().allow(null, ''),
  scoring_type: Joi.string().valid(...ALLOWED_SCORING_TYPES),
  status: Joi.string().trim(),
  description: Joi.string().allow(null, ''),
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

module.exports = {
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
