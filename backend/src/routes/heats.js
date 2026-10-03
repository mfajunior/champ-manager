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
// Remanejamento manual de raias. Vem ANTES de '/:id' de propósito: o Express
// casa as rotas na ordem em que são declaradas, e '/lanes/swap' bateria em
// '/:id' com id='lanes' se viesse depois.
//
// Trocar duas equipes de lugar. Segura por construção: os tamanhos das
// baterias não mudam e nenhuma raia fica duplicada no fim.
router.post('/lanes/swap', authMiddleware, heatController.swapLanes);

// Mover uma equipe para uma raia livre de outra bateria da mesma prova.
// Complementa a troca: com a distribuição equilibrada as baterias têm
// tamanhos diferentes, e passar alguém da cheia para a que sobrou raia não é
// uma troca.
router.put('/lanes/:heat_team_id', authMiddleware, heatController.moveLane);

router.put('/:id', authMiddleware, heatController.update);

module.exports = router;
