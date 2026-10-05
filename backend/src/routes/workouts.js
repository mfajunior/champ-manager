const express = require('express');
const router = express.Router();
const workoutController = require('../controllers/workoutController');
const workoutCutController = require('../controllers/workoutCutController');
const heatController = require('../controllers/heatController');
const { authMiddleware } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validations/schemas');
const { cacheDeLeitura } = require('../middleware/cacheLeitura');

/**
 * Tudo que é filho de uma prova mora aqui — variantes e baterias incluídas.
 * Concentrar num arquivo só evita o conflito de rotas que aparece quando o
 * mesmo recurso é declarado em dois routers diferentes.
 *
 * Rotas com mais segmentos vêm primeiro por clareza. Não é obrigatório: o
 * Express casa o padrão inteiro, então "/:id" nunca captura "/5/heats".
 */

// ---- Baterias de uma prova ----
// POST /api/workouts/:workout_id/heats - Gerar baterias de uma categoria (protegido)
router.post('/:workout_id/heats', authMiddleware, heatController.generate);

// GET /api/workouts/:workout_id/heats - Listar baterias (público)
// 10 s: esta resposta traz as raias COM o resultado de cada uma embutido
// (place, raw_value, place_2), então ela muda a cada lançamento — 87 vezes no
// dia do evento. Cacheável só porque a invalidação por escrita cobre isso.
router.get('/:workout_id/heats', cacheDeLeitura(10), heatController.getByWorkout);

// ---- Variantes por categoria ----
// PUT /api/workouts/:workout_id/variants/:category_id - Criar ou atualizar variante (protegido)
router.put('/:workout_id/variants/:category_id', authMiddleware, workoutController.upsertVariant);

// DELETE /api/workouts/:workout_id/variants/:category_id - Remover variante (protegido)
router.delete('/:workout_id/variants/:category_id', authMiddleware, workoutController.deleteVariant);

// ---- Provas ----
// POST /api/workouts - Criar prova (protegido)
router.post(
  '/',
  authMiddleware,
  validate(schemas.workoutCreate),
  workoutController.create
);

// GET /api/workouts?championship_id=1 - Listar provas do campeonato (público)
// 60 s: descrição do WOD por categoria, congelada desde a véspera do evento.
router.get('/', cacheDeLeitura(60), workoutController.getAll);

// GET /api/workouts/:id - Detalhe da prova com todas as variantes (público)
router.get('/:id', cacheDeLeitura(60), workoutController.getById);

// PUT /api/workouts/:id - Atualizar prova (protegido)
router.put(
  '/:id',
  authMiddleware,
  validate(schemas.workoutUpdate),
  workoutController.update
);

// DELETE /api/workouts/:id - Deletar prova (protegido)
router.delete('/:id', authMiddleware, workoutController.delete);

// ---------------------------------------------------------------------------
// Corte por prova: "esta prova é disputada só pelo top N de cada categoria"
// ---------------------------------------------------------------------------

// GET /api/workouts/:workout_id/cut - Cortes configurados (público)
router.get('/:workout_id/cut', workoutCutController.get);

// PUT /api/workouts/:workout_id/cut - Configurar o corte (protegido)
router.put(
  '/:workout_id/cut',
  authMiddleware,
  validate(schemas.workoutCutSet),
  workoutCutController.upsert
);

// DELETE /api/workouts/:workout_id/cut?category_id=N - Remover (protegido)
router.delete('/:workout_id/cut', authMiddleware, workoutCutController.remove);

// GET /api/workouts/:workout_id/eligible-teams - Quem disputa, por categoria,
// e se as baterias já geradas ainda batem com essa lista (público: a tela de
// baterias precisa disso antes de gerar).
router.get('/:workout_id/eligible-teams', workoutCutController.eligibleTeams);

module.exports = router;
