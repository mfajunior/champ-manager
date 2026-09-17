const { query, queryOne, queryAll } = require('../config/database');

/**
 * O organizador lança apenas o desempenho bruto (tempo, reps ou carga) ou
 * marca did_not_finish. A colocação (place) nunca é digitada — é calculada
 * pelo trigger trg_result_changed a cada INSERT/UPDATE/DELETE, que chama
 * recalculate_placements (migration 003).
 *
 * Por isso toda função aqui, depois de escrever no banco, faz um SELECT
 * separado para reler a linha: o trigger roda DEPOIS do INSERT/UPDATE
 * original, então o RETURNING desse comando ainda não veria o place novo.
 */

// Confere a regra da constraint results_value_or_dnf antes de ir ao banco,
// para devolver uma mensagem clara em vez do erro cru do Postgres.
const validateScoreShape = (rawValue, didNotFinish) => {
  const isDnf = didNotFinish === true;
  const hasValue = rawValue !== undefined && rawValue !== null && rawValue !== '';

  if (isDnf && hasValue) {
    return 'Não é possível informar raw_value e did_not_finish ao mesmo tempo';
  }
  if (!isDnf && !hasValue) {
    return 'Informe raw_value ou marque did_not_finish: true';
  }
  return null;
};

// Exportada à parte para dar pra testar sem precisar de banco nem de req/res
// (tests/unit/resultController.test.js).
exports.validateScoreShape = validateScoreShape;

/**
 * Avisa quem está ouvindo o leaderboard daquele campeonato via WebSocket.
 *
 * O trigger do Postgres recalcula team_standings sozinho, mas um trigger de
 * banco não tem como emitir evento nenhum — só sabe mexer em tabela. Alguém
 * do lado do Node precisa perceber "um resultado mudou" e empurrar o dado
 * novo para os clientes inscritos. Como é aqui que sabemos que um resultado
 * foi criado/corrigido/apagado, é aqui que isso acontece.
 *
 * Broadcast é por CAMPEONATO inteiro (todas as categorias juntas), porque a
 * sala do Socket.io (`subscribe_championship`, em server.js) também é só por
 * campeonato — não existe sala por categoria hoje. O cliente que só quer ver
 * uma categoria filtra a lista recebida do lado dele.
 *
 * Nunca deixa uma falha aqui derrubar a resposta HTTP: o resultado já foi
 * salvo com sucesso no banco antes desta função ser chamada — se o socket
 * falhar, quem lançou o resultado ainda deve receber 200/201 normalmente.
 */
const broadcastLeaderboard = async (req, heatTeamId) => {
  try {
    const broadcast = req.app?.locals?.broadcastLeaderboardUpdate;
    if (!broadcast) return; // socket não subiu (ex.: rodando em teste sem server.js)

    const context = await queryOne(
      `SELECT w.championship_id
       FROM heat_teams ht
       JOIN heats h ON h.id = ht.heat_id
       JOIN workouts w ON w.id = h.workout_id
       WHERE ht.id = $1`,
      [heatTeamId]
    );

    if (!context) return;

    // Mesma forma de consulta do leaderboardController, sem filtro de
    // categoria — o campeonato inteiro é o que a sala do socket representa.
    const standings = await queryAll(
      `SELECT ts.id, ts.team_id, t.name AS team_name,
              ts.category_id, c.name AS category_name,
              ts.total_score, ts."place", ts.workouts_completed, ts.updated_at
       FROM team_standings ts
       JOIN teams t ON t.id = ts.team_id
       JOIN categories c ON c.id = ts.category_id
       WHERE ts.championship_id = $1
       ORDER BY c.id ASC, ts."place" ASC`,
      [context.championship_id]
    );

    broadcast(context.championship_id, standings);
  } catch (error) {
    console.error('Falha ao emitir leaderboard via WebSocket:', error.message);
  }
};

// POST /api/results  (protegido)
// body: { heat_team_id, raw_value, did_not_finish }
exports.create = async (req, res, next) => {
  try {
    const { heat_team_id, raw_value, did_not_finish } = req.body;

    if (!heat_team_id) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'heat_team_id é obrigatório' },
      });
    }

    const shapeError = validateScoreShape(raw_value, did_not_finish);
    if (shapeError) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: shapeError },
      });
    }

    const heatTeam = await queryOne('SELECT id FROM heat_teams WHERE id = $1', [heat_team_id]);

    if (!heatTeam) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'heat_team_id não encontrado' },
      });
    }

    // O banco já tem UNIQUE(heat_team_id), mas checar aqui devolve uma
    // mensagem legível em vez do erro cru de violação de constraint.
    const existing = await queryOne(
      'SELECT id FROM results WHERE heat_team_id = $1',
      [heat_team_id]
    );

    if (existing) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Já existe um resultado para esta equipe nesta bateria. Use PUT para corrigir.',
        },
      });
    }

    const isDnf = did_not_finish === true;

    const inserted = await queryOne(
      `INSERT INTO results (heat_team_id, raw_value, did_not_finish, recorded_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [heat_team_id, isDnf ? null : raw_value, isDnf, req.user.id]
    );

    // Segundo SELECT: agora o trigger já rodou e o place está calculado.
    const result = await queryOne(
      `SELECT id, heat_team_id, "place", raw_value, did_not_finish, recorded_at
       FROM results WHERE id = $1`,
      [inserted.id]
    );

    await broadcastLeaderboard(req, result.heat_team_id);

    res.status(201).json({
      data: result,
      meta: { message: 'Resultado registrado com sucesso' },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/results?workout_id=1&category_id=3  (público)
// category_id é opcional: sem ele, lista a prova inteira (todas as categorias).
exports.getByWorkout = async (req, res, next) => {
  try {
    const { workout_id, category_id } = req.query;

    if (!workout_id) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'workout_id é obrigatório na query string' },
      });
    }

    const workout = await queryOne(
      'SELECT id, scoring_type FROM workouts WHERE id = $1',
      [workout_id]
    );

    if (!workout) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Prova não encontrada' },
      });
    }

    // $2 nulo desliga o filtro de categoria, igual ao padrão usado em teams/getAll.
    const results = await queryAll(
      `SELECT r.id, r.heat_team_id, r."place", r.raw_value, r.did_not_finish, r.recorded_at,
              t.id AS team_id, t.name AS team_name,
              h.category_id, c.name AS category_name
       FROM results r
       JOIN heat_teams ht ON ht.id = r.heat_team_id
       JOIN heats h ON h.id = ht.heat_id
       JOIN teams t ON t.id = ht.team_id
       JOIN categories c ON c.id = h.category_id
       WHERE h.workout_id = $1
         AND ($2::int IS NULL OR h.category_id = $2::int)
       ORDER BY c.id ASC, r."place" ASC`,
      [workout_id, category_id || null]
    );

    res.status(200).json({
      data: results,
      meta: {
        message: 'Resultados recuperados com sucesso',
        scoringType: workout.scoring_type,
        total: results.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/results/:id  (protegido)
// body: { raw_value?, did_not_finish? }
// Aceita atualizar só um dos dois campos: o outro mantém o valor atual da linha.
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { raw_value, did_not_finish } = req.body;

    const current = await queryOne(
      'SELECT id, raw_value, did_not_finish FROM results WHERE id = $1',
      [id]
    );

    if (!current) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Resultado não encontrado' },
      });
    }

    const nextDnf = did_not_finish !== undefined ? did_not_finish === true : current.did_not_finish;
    const nextValue = raw_value !== undefined ? raw_value : current.raw_value;

    const shapeError = validateScoreShape(nextValue, nextDnf);
    if (shapeError) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: shapeError },
      });
    }

    await query(
      'UPDATE results SET raw_value = $1, did_not_finish = $2 WHERE id = $3',
      [nextDnf ? null : nextValue, nextDnf, id]
    );

    const updated = await queryOne(
      `SELECT id, heat_team_id, "place", raw_value, did_not_finish, recorded_at
       FROM results WHERE id = $1`,
      [id]
    );

    await broadcastLeaderboard(req, updated.heat_team_id);

    res.status(200).json({
      data: updated,
      meta: { message: 'Resultado atualizado com sucesso' },
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/results/:id  (protegido)
// O trigger recalcula placement da categoria e standings do campeonato
// automaticamente após o DELETE — nenhuma chamada extra é necessária para o
// banco. Mas para o broadcast precisamos do heat_team_id ANTES de apagar a
// linha, porque depois do DELETE ele não existe mais para consultar.
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await queryOne(
      'SELECT id, heat_team_id FROM results WHERE id = $1',
      [id]
    );

    if (!result) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Resultado não encontrado' },
      });
    }

    await query('DELETE FROM results WHERE id = $1', [id]);

    await broadcastLeaderboard(req, result.heat_team_id);

    res.status(200).json({
      data: null,
      meta: { message: 'Resultado deletado com sucesso' },
    });
  } catch (error) {
    next(error);
  }
};
