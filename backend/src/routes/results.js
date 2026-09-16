const express = require('express');
const router = express.Router();
const resultController = require('../controllers/resultController');
const { authMiddleware } = require('../middleware/auth');

// POST /api/results - Registrar resultado (protegido)
router.post('/', authMiddleware, resultController.create);

// GET /api/results?workout_id=1&category_id=3 - Listar resultados (público)
// category_id é opcional: sem ele, lista a prova inteira
router.get('/', resultController.getByWorkout);

// PUT /api/results/:id - Corrigir um resultado lançado (protegido)
router.put('/:id', authMiddleware, resultController.update);

// DELETE /api/results/:id - Remover um resultado lançado por engano (protegido)
router.delete('/:id', authMiddleware, resultController.delete);

module.exports = router;
