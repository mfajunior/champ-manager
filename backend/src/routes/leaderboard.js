const express = require('express');
const router = express.Router();
const leaderboardController = require('../controllers/leaderboardController');

// GET /api/leaderboard?championship_id=1&category_id=3 - Ranking por categoria (público)
// category_id é opcional: sem ele, traz todas as categorias do campeonato.
// Não há POST/PUT/DELETE aqui: team_standings é só leitura, mantida pelo
// trigger que roda em cima de results (ver migration 003).
router.get('/', leaderboardController.getByChampionship);

module.exports = router;
