const express = require('express');
const router = express.Router();
const heatController = require('../controllers/heatController');
const { authMiddleware } = require('../middleware/auth');

/**
 * A geração e a listagem de baterias moram em /api/workouts/:workout_id/heats,
 * porque uma bateria só existe dentro de uma prova.
 * Aqui ficam as operações sobre uma bateria já existente, que se identifica
 * sozinha pelo id — não precisa da prova na URL.
 */

// PUT /api/heats/:id - Ajustar horário ou status da bateria (protegido)
router.put('/:id', authMiddleware, heatController.update);

module.exports = router;
