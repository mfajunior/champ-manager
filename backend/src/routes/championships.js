const express = require('express');
const router = express.Router();
const championshipController = require('../controllers/championshipController');
const pointsTableController = require('../controllers/pointsTableController');
const { authMiddleware } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validations/schemas');

/**
 * As provas do campeonato saíram daqui e foram para GET /api/workouts?championship_id=N.
 * Manter "/:championship_id/workouts" neste router significava declarar rotas de
 * workout em dois arquivos — que foi exatamente o que causou o conflito entre
 * "/:id" e "/:championship_id/workouts".
 */

// POST /api/championships - Criar campeonato + 5 categorias padrão (protegido)
router.post(
  '/',
  authMiddleware,
  validate(schemas.championshipCreate),
  championshipController.create
);

// GET /api/championships - Listar campeonatos (público)
router.get('/', championshipController.getAll);

// GET /api/championships/:id - Detalhe com categorias e contagem de equipes (público)
router.get('/:id', championshipController.getById);

// PUT /api/championships/:id - Atualizar campeonato (protegido)
router.put(
  '/:id',
  authMiddleware,
  validate(schemas.championshipUpdate),
  championshipController.update
);

// DELETE /api/championships/:id - Deletar campeonato (protegido)
router.delete('/:id', authMiddleware, championshipController.delete);

// PUT /api/championships/:id/scoring-model - Trocar o modelo de pontuação (protegido)
// Dois segmentos, então não colide com "/:id" acima.
router.put(
  '/:championship_id/scoring-model',
  authMiddleware,
  validate(schemas.scoringModelSet),
  pointsTableController.setScoringModel
);

// ---------------------------------------------------------------------------
// Tabelas de pontos (modelo points_table)
// ---------------------------------------------------------------------------
// Ficam neste router, e não em arquivo próprio, porque só existem aninhadas sob
// um campeonato — declarar "/:championship_id/points-tables" em outro arquivo
// repetiria exatamente o conflito descrito no comentário do topo.
//
// Não colidem com "/:id" acima: aquela rota tem um segmento, estas têm dois ou
// mais, e o Express casa por número de segmentos antes do nome do parâmetro.

// GET .../points-tables - Listar com as faixas (público: o placar mostra a régua)
router.get('/:championship_id/points-tables', pointsTableController.list);

// GET .../points-tables/:id/preview - Tabela colocação a colocação + aviso de zeragem
router.get(
  '/:championship_id/points-tables/:points_table_id/preview',
  pointsTableController.preview
);

// POST .../points-tables - Criar tabela com as faixas no mesmo corpo (protegido)
router.post(
  '/:championship_id/points-tables',
  authMiddleware,
  validate(schemas.pointsTableCreate),
  pointsTableController.create
);

// PUT .../points-tables/:id - Atualizar; mandar ranges substitui todas (protegido)
router.put(
  '/:championship_id/points-tables/:points_table_id',
  authMiddleware,
  validate(schemas.pointsTableUpdate),
  pointsTableController.update
);

// DELETE .../points-tables/:id - Excluir (protegido)
router.delete(
  '/:championship_id/points-tables/:points_table_id',
  authMiddleware,
  pointsTableController.remove
);

module.exports = router;
