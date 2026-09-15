const express = require('express');
const router = express.Router();
const teamController = require('../controllers/teamController');
const { authMiddleware } = require('../middleware/auth');

// POST /api/teams - Registrar equipe (protegido)
router.post('/', authMiddleware, teamController.create);

// GET /api/teams?championship_id=1&category_id=3 - Listar equipes (público)
// category_id é opcional: sem ele, retorna o campeonato inteiro
router.get('/', teamController.getAll);

// GET /api/teams/:id - Detalhe da equipe (público)
router.get('/:id', teamController.getById);

// PUT /api/teams/:id - Atualizar equipe (protegido)
router.put('/:id', authMiddleware, teamController.update);

// DELETE /api/teams/:id - Deletar equipe (protegido)
router.delete('/:id', authMiddleware, teamController.delete);

module.exports = router;
