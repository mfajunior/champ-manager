const express = require('express');
const router = express.Router();
const workoutController = require('../controllers/workoutController');
const heatController = require('../controllers/heatController');
const { authMiddleware } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validations/schemas');

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
router.get('/:workout_id/heats', heatController.getByWorkout);

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
router.get('/', workoutController.getAll);

// GET /api/workouts/:id - Detalhe da prova com todas as variantes (público)
router.get('/:id', workoutController.getById);

// PUT /api/workouts/:id - Atualizar prova (protegido)
router.put(
  '/:id',
  authMiddleware,
  validate(schemas.workoutUpdate),
  workoutController.update
);

// DELETE /api/workouts/:id - Deletar prova (protegido)
router.delete('/:id', authMiddleware, workoutController.delete);

module.exports = router;
