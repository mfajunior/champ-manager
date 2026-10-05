const express = require('express');
const router = express.Router();
const leaderboardController = require('../controllers/leaderboardController');
const { cacheDeLeitura } = require('../middleware/cacheLeitura');

// GET /api/leaderboard?championship_id=1&category_id=3 - Ranking por categoria (público)
// category_id é opcional: sem ele, traz todas as categorias do campeonato.
// Não há POST/PUT/DELETE aqui: team_standings é só leitura, mantida pelo
// trigger que roda em cima de results (ver migration 003).
// 5 s: é a rota que cem espectadores abrem no mesmo segundo quando uma bateria
// termina. TTL curto porque é o dado mais sensível do evento; a correção de
// verdade vem da invalidação por escrita, não daqui.
router.get('/', cacheDeLeitura(5), leaderboardController.getByChampionship);

module.exports = router;
