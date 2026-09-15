const express = require('express');
const router = express.Router();
const championshipController = require('../controllers/championshipController');
const workoutController = require('../controllers/workoutController');
const { authMiddleware } = require('../middleware/auth');

// POST /api/championships - Criar campeonato (protegido)
router.post('/', authMiddleware, championshipController.create);

// GET /api/championships/:id - Detalhe do campeonato (público)
router.get('/:id', championshipController.getById);

// GET /api/workouts/:championship_id - Lista de WODs por Campeonato (público)
router.get('/:championship_id/workouts', workoutController.getByChampionship);

module.exports = router;
