const express = require('express');
const router = express.Router();
const workoutController = require('../controllers/workoutController');
const { authMiddleware } = require('../middleware/auth');

// POST /api/workouts - Criar WOD (protegido)
router.post('/', authMiddleware, workoutController.create);

// GET /api/workouts/:id - Detalhe do WOD (público)
router.get('/:id', workoutController.getById);

// PUT /api/workouts/:id - Atualizar WOD (protegido)
router.put('/:id', authMiddleware, workoutController.update);

// DELETE /api/workouts/:id - Deletar WOD (protegido)
router.delete('/:id', authMiddleware, workoutController.delete);
module.exports = router;
