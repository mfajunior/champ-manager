const { pool, queryOne, queryAll } = require('../config/database');

/**
 * GERAÇÃO DE BATERIAS
 *
 * A restrição física é o número de raias do box, não o número de baterias.
 * O organizador informa quantas raias tem; o sistema calcula quantas baterias
 * são necessárias e distribui as equipes de forma equilibrada.
 *
 * Por que equilibrado e não "encher cada bateria até o limite":
 *   6 equipes, 4 raias
 *   - enchendo:     bateria 1 com 4, bateria 2 com 2   → última fica esvaziada
 *   - equilibrado:  bateria 1 com 3, bateria 2 com 3   → 1 raia livre em cada
 *
 * Duas baterias de 3 dão a mesma condição de prova para todo mundo: mesmo
 * barulho, mesma quantidade de gente competindo ao lado, mesmo tempo de
 * transição. É o que se faz num campeonato de verdade.
 *
 * O round-robin (índice % número de baterias) produz essa distribuição sem
 * nenhuma conta extra — a diferença entre a maior e a menor bateria nunca passa
 * de uma equipe.
 */
const distributeTeams = (teams, numHeats) => {
  const buckets = Array.from({ length: numHeats }, () => []);
  teams.forEach((team, index) => {
    buckets[index % numHeats].push(team);
  });
  return buckets;
};

// POST /api/workouts/:workout_id/heats  (protegido)
// body: { category_id, lanes_per_heat, start_time?, interval_minutes?, force? }
exports.generate = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { workout_id } = req.params;
    const {
      category_id,
      lanes_per_heat,
      start_time,
      interval_minutes,
      force = false,
    } = req.body;

    if (!category_id || !lanes_per_heat) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'category_id e lanes_per_heat são obrigatórios',
        },
      });
    }

    const lanes = Number(lanes_per_heat);
    if (!Number.isInteger(lanes) || lanes < 1) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'lanes_per_heat deve ser um inteiro maior que zero',
        },
      });
    }

    const workout = await queryOne(
      'SELECT id, championship_id, workout_number, name FROM workouts WHERE id = $1',
      [workout_id]
    );

    if (!workout) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Prova não encontrada' },
      });
    }

    const category = await queryOne(
      'SELECT id, championship_id, name FROM categories WHERE id = $1',
      [category_id]
    );

    if (!category) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Categoria não encontrada' },
      });
    }

    if (Number(category.championship_id) !== Number(workout.championship_id)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A categoria não pertence ao mesmo campeonato da prova',
        },
      });
    }

    const teams = await queryAll(
      'SELECT id, name FROM teams WHERE category_id = $1 ORDER BY id ASC',
      [category_id]
    );

    if (teams.length === 0) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `Nenhuma equipe registrada na categoria ${category.name}`,
        },
      });
    }

    // Regerar apaga os heats desta prova/categoria. O CASCADE leva junto os
    // heat_teams e, por tabela, os results já lançados. Sem esta trava, um
    // clique acidental no botão "gerar baterias" zeraria a prova.
    const existingResults = await queryOne(
      `SELECT COUNT(r.id)::int AS total
       FROM results r
       JOIN heat_teams ht ON ht.id = r.heat_team_id
       JOIN heats h ON h.id = ht.heat_id
       WHERE h.workout_id = $1 AND h.category_id = $2`,
      [workout_id, category_id]
    );

    if (existingResults.total > 0 && !force) {
      return res.status(409).json({
        error: {
          code: 'RESULTS_EXIST',
          message:
            `Já existem ${existingResults.total} resultado(s) lançado(s) nesta prova para ` +
            `a categoria ${category.name}. Regerar as baterias apagaria esses resultados. ` +
            `Envie force: true se for mesmo isso que você quer.`,
        },
      });
    }

    const numHeats = Math.ceil(teams.length / lanes);
    const buckets = distributeTeams(teams, numHeats);

    await client.query('BEGIN');

    await client.query(
      'DELETE FROM heats WHERE workout_id = $1 AND category_id = $2',
      [workout_id, category_id]
    );

    const createdHeats = [];

    for (let i = 0; i < buckets.length; i += 1) {
      const heatNumber = i + 1;

      let scheduledTime = null;
      if (start_time) {
        const base = new Date(start_time);
        if (Number.isNaN(base.getTime())) {
          throw Object.assign(new Error('start_time inválido'), {
            status: 400,
            code: 'VALIDATION_ERROR',
          });
        }
        const step = Number(interval_minutes) || 0;
        scheduledTime = new Date(base.getTime() + i * step * 60_000);
      }

      const heat = await client.query(
        `INSERT INTO heats (workout_id, heat_number, category_id, scheduled_time)
         VALUES ($1, $2, $3, $4)
         RETURNING id, workout_id, heat_number, category_id, scheduled_time, status`,
        [workout_id, heatNumber, category_id, scheduledTime]
      );

      const heatRow = heat.rows[0];
      const lanesUsed = [];

      for (let laneIndex = 0; laneIndex < buckets[i].length; laneIndex += 1) {
        const team = buckets[i][laneIndex];
        const laneNumber = laneIndex + 1;

        await client.query(
          `INSERT INTO heat_teams (heat_id, team_id, lane_number)
           VALUES ($1, $2, $3)`,
          [heatRow.id, team.id, laneNumber]
        );

        lanesUsed.push({ lane_number: laneNumber, team_id: team.id, team_name: team.name });
      }

      createdHeats.push({
        ...heatRow,
        teams: lanesUsed,
        lanes_used: lanesUsed.length,
        lanes_empty: lanes - lanesUsed.length,
      });
    }

    await client.query('COMMIT');

    res.status(201).json({
      data: createdHeats,
      meta: {
        message: 'Baterias geradas com sucesso',
        workout: { id: workout.id, number: workout.workout_number, name: workout.name },
        category: { id: category.id, name: category.name },
        totalTeams: teams.length,
        lanesPerHeat: lanes,
        heatsCreated: numHeats,
        replacedExistingResults: existingResults.total > 0,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

// GET /api/workouts/:workout_id/heats?category_id=3  (público)
exports.getByWorkout = async (req, res, next) => {
  try {
    const { workout_id } = req.params;
    const { category_id } = req.query;

    const workout = await queryOne('SELECT id FROM workouts WHERE id = $1', [workout_id]);

    if (!workout) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Prova não encontrada' },
      });
    }

    const heats = await queryAll(
      `SELECT h.id, h.workout_id, h.heat_number, h.category_id, c.name AS category_name,
              h.scheduled_time, h.status
       FROM heats h
       JOIN categories c ON c.id = h.category_id
       WHERE h.workout_id = $1
         AND ($2::int IS NULL OR h.category_id = $2::int)
       ORDER BY c.id ASC, h.heat_number ASC`,
      [workout_id, category_id || null]
    );

    if (heats.length === 0) {
      return res.status(200).json({
        data: [],
        meta: { message: 'Nenhuma bateria gerada para esta prova' },
      });
    }

    // Uma query para todas as raias, em vez de uma por bateria dentro de um loop.
    // ht.id (heat_team_id) vai junto: é o identificador que POST /api/results espera
    // para saber contra qual raia o resultado está sendo lançado.
    const heatIds = heats.map((h) => h.id);
    const lanes = await queryAll(
      `SELECT ht.id AS heat_team_id, ht.heat_id, ht.lane_number, ht.team_id, t.name AS team_name,
              r.id AS result_id, r."place", r.raw_value, r.did_not_finish
       FROM heat_teams ht
       JOIN teams t ON t.id = ht.team_id
       LEFT JOIN results r ON r.heat_team_id = ht.id
       WHERE ht.heat_id = ANY($1::int[])
       ORDER BY ht.lane_number ASC`,
      [heatIds]
    );

    const lanesByHeat = lanes.reduce((acc, lane) => {
      (acc[lane.heat_id] ||= []).push(lane);
      return acc;
    }, {});

    const data = heats.map((heat) => ({
      ...heat,
      teams: lanesByHeat[heat.id] || [],
    }));

    res.status(200).json({
      data,
      meta: { message: 'Baterias recuperadas com sucesso', total: heats.length },
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/heats/:id  (protegido)
// body: { scheduled_time?, status? }
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { scheduled_time, status } = req.body;

    if (scheduled_time === undefined && status === undefined) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Informe ao menos scheduled_time ou status',
        },
      });
    }

    const ALLOWED_STATUS = ['scheduled', 'in_progress', 'completed'];
    if (status !== undefined && !ALLOWED_STATUS.includes(status)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `status deve ser um de: ${ALLOWED_STATUS.join(', ')}`,
        },
      });
    }

    const heat = await queryOne('SELECT id FROM heats WHERE id = $1', [id]);

    if (!heat) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Bateria não encontrada' },
      });
    }

    const updated = await queryOne(
      `UPDATE heats
       SET scheduled_time = COALESCE($1, scheduled_time),
           status         = COALESCE($2, status),
           updated_at     = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, workout_id, heat_number, category_id, scheduled_time, status`,
      [scheduled_time ?? null, status ?? null, id]
    );

    res.status(200).json({
      data: updated,
      meta: { message: 'Bateria atualizada com sucesso' },
    });
  } catch (error) {
    next(error);
  }
};
