const express = require('express');
const router = express.Router();
const teamController = require('../controllers/teamController');
const { authMiddleware } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validations/schemas');

// POST /api/teams - Registrar equipe (protegido)
router.post('/', authMiddleware, validate(schemas.teamCreate), teamController.create);

// GET /api/teams?championship_id=1&category_id=3 - Listar equipes (público)
// category_id é opcional: sem ele, retorna o campeonato inteiro
router.get('/', teamController.getAll);

// GET /api/teams/:id - Detalhe da equipe (público)
router.get('/:id', teamController.getById);

// GET /api/teams/:id/results - Resultado da equipe em cada prova do campeonato,
// incluindo as que ainda não rolou (público) — usado no clique da equipe no
// leaderboard.
router.get('/:id/results', teamController.getResults);

// PUT /api/teams/:id - Atualizar equipe (protegido)
router.put('/:id', authMiddleware, validate(schemas.teamUpdate), teamController.update);

// DELETE /api/teams/:id - Deletar equipe (protegido)
router.delete('/:id', authMiddleware, teamController.delete);

module.exports = router;
