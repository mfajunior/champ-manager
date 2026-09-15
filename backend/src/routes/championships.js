const express = require('express');
const router = express.Router();
const championshipController = require('../controllers/championshipController');
const { authMiddleware } = require('../middleware/auth');

/**
 * As provas do campeonato saíram daqui e foram para GET /api/workouts?championship_id=N.
 * Manter "/:championship_id/workouts" neste router significava declarar rotas de
 * workout em dois arquivos — que foi exatamente o que causou o conflito entre
 * "/:id" e "/:championship_id/workouts".
 */

// POST /api/championships - Criar campeonato + 5 categorias padrão (protegido)
router.post('/', authMiddleware, championshipController.create);

// GET /api/championships - Listar campeonatos (público)
router.get('/', championshipController.getAll);

// GET /api/championships/:id - Detalhe com categorias e contagem de equipes (público)
router.get('/:id', championshipController.getById);

// PUT /api/championships/:id - Atualizar campeonato (protegido)
router.put('/:id', authMiddleware, championshipController.update);

// DELETE /api/championships/:id - Deletar campeonato (protegido)
router.delete('/:id', authMiddleware, championshipController.delete);

module.exports = router;
