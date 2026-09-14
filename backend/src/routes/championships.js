const express = require('express');
const router = express.Router();
const championshipController = require('../controllers/championshipController');
const { authMiddleware } = require('../middleware/auth');

// POST /api/championships - Criar campeonato (protegido)
router.post('/', authMiddleware, championshipController.create);

// GET /api/championships/:id - Detalhe do campeonato (público)
router.get('/:id', championshipController.getById);

module.exports = router;
