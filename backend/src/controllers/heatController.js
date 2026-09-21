const { pool, queryOne, queryAll } = require('../config/database');

/**
 * ORDEM FIXA DE DISPUTA
 *
 * Categorias diferentes podem competir na mesma bateria agora — o que sobra
 * de raia de uma categoria é preenchido com a categoria seguinte, em vez de
 * deixar raia vazia até a próxima prova. A ordem é sempre a mesma, campeonato
 * inteiro: nível (iniciante -> scale -> rx) e, dentro do nível, gênero
 * (feminino -> masculino -> misto).
 *
 * Só entram aqui categorias com pelo menos 1 equipe cadastrada — uma
 * categoria vazia não aparece na sequência e não "gasta" bateria nenhuma.
 */
const LEVEL_ORDER = { iniciante: 1, scale: 2, rx: 3 };
const GENDER_ORDER = { feminino: 1, masculino: 2, misto: 3 };

const categorySortKey = (category) =>
  (LEVEL_ORDER[category.level] ?? 99) * 10 + (GENDER_ORDER[category.gender] ?? 99);

/**
 * Achata equipe-a-equipe, já na ordem final de disputa, e divide em baterias
 * de até `lanesPerHeat` raias. Pura e sem banco de propósito — dá pra testar
 * a lógica de preenchimento sem subir Postgres (tests/unit/heatController.test.js).
 *
 * Substitui o antigo `distributeTeams` (round-robin balanceado DENTRO de uma
 * categoria só). Esse balanceamento não faz mais sentido com baterias mistas:
 * o que sobra de uma categoria é completado pela próxima da sequência, então
 * "bateria cheia até a última" deixou de ser um problema a resolver — só a
 * bateria final do campeonato inteiro (a última categoria, sem mais ninguém
 * pra completar) pode sobrar incompleta, e isso é inevitável, não um bug.
 */
const chunkIntoHeats = (assignments, lanesPerHeat) => {
  const chunks = [];
  for (let i = 0; i < assignments.length; i += lanesPerHeat) {
    chunks.push(assignments.slice(i, i + lanesPerHeat));
  }
  return chunks;
};
exports.chunkIntoHeats = chunkIntoHeats;

/**
 * Calcula o horário de início de cada bateria em sequência, pura e sem banco.
 *
 * `startCursor`: Date da âncora inicial (horário calculado da última bateria
 * já agendada em QUALQUER prova do campeonato, ou o início do campeonato se
 * essa é a primeira geração), ou null se nenhuma das duas está disponível
 * (campeonato sem hora de início definida e nenhuma bateria anterior
 * agendada) — nesse caso ninguém recebe horário.
 *
 * `heatPlans`: lista na ordem de geração, cada item com `durationSeconds`
 * (maior time cap entre as categorias daquela bateria, ou null se alguma
 * delas não tem time cap definido pra essa prova).
 *
 * Uma vez que uma bateria de duração desconhecida aparece, o cursor vira
 * null e todas as baterias SEGUINTES também ficam sem horário — não dá pra
 * saber quando uma bateria começa sem saber quando a anterior termina.
 */
const computeHeatSchedule = (heatPlans, { startCursor, transitionSeconds }) => {
  let cursor = startCursor;
  return heatPlans.map((plan) => {
    if (!cursor) {
      return { scheduledTime: null };
    }
    const scheduledTime = new Date(cursor.getTime());
    if (typeof plan.durationSeconds === 'number') {
      cursor = new Date(cursor.getTime() + (plan.durationSeconds + transitionSeconds) * 1000);
    } else {
      cursor = null;
    }
    return { scheduledTime };
  });
};
exports.computeHeatSchedule = computeHeatSchedule;

// POST /api/workouts/:workout_id/heats  (protegido)
// body: { force? }
// Raias, transição e horário de início não são mais parâmetros da chamada —
// são globais do campeonato (championships.lanes_per_heat/transition_seconds
// /start_time, configurados uma vez). A prova inteira é gerada de uma vez,
// cruzando todas as categorias com equipe cadastrada, não mais uma categoria
// por chamada.
exports.generate = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { workout_id } = req.params;
    const { force = false } = req.body;

    const workout = await queryOne(
      'SELECT id, championship_id, workout_number, name FROM workouts WHERE id = $1',
      [workout_id]
    );

    if (!workout) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Prova não encontrada' },
      });
    }

    // to_char em vez de deixar o driver converter DATE/TIME: evita qualquer
    // ambiguidade de fuso horário na hora de montar a string combinada
    // "data + hora" mais abaixo — o mesmo cuidado que já existe no resto do
    // projeto com horário (ver comentário de trust proxy em app.js).
    const championship = await queryOne(
      `SELECT id, lanes_per_heat, transition_seconds,
              to_char(date, 'YYYY-MM-DD') AS date_str,
              to_char(start_time, 'HH24:MI:SS') AS start_time_str
       FROM championships WHERE id = $1`,
      [workout.championship_id]
    );

    if (!championship.lanes_per_heat) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message:
            'Defina o número de raias do campeonato antes de gerar baterias (configurações do campeonato).',
        },
      });
    }

    const lanes = championship.lanes_per_heat;
    const transitionSeconds = championship.transition_seconds ?? 0;

    const categories = await queryAll(
      `SELECT c.id, c.name, c.gender, c.level
       FROM categories c
       WHERE c.championship_id = $1
         AND EXISTS (SELECT 1 FROM teams t WHERE t.category_id = c.id)`,
      [workout.championship_id]
    );

    if (categories.length === 0) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Nenhuma equipe registrada neste campeonato' },
      });
    }

    categories.sort((a, b) => categorySortKey(a) - categorySortKey(b));

    // Todas as equipes das categorias envolvidas numa query só. Antes era
    // uma query por categoria dentro do loop (5 idas ao banco com as
    // categorias padrão) pra montar uma lista que é usada de uma vez.
    //
    // Quem decide a ordem de disputa continua sendo o JS, não o ORDER BY: a
    // sequência entre categorias vem de `categories` (já ordenada por
    // categorySortKey acima) e, dentro de cada uma, de id ASC. Por isso as
    // linhas são agrupadas por categoria antes de achatar — um ORDER BY
    // category_id no SQL ordenaria por id da categoria, que não é a ordem de
    // disputa.
    const teamRows = await queryAll(
      'SELECT id, name, category_id FROM teams WHERE category_id = ANY($1::int[]) ORDER BY id ASC',
      [categories.map((c) => c.id)]
    );

    const teamsByCategory = teamRows.reduce((acc, team) => {
      (acc[team.category_id] ||= []).push(team);
      return acc;
    }, {});

    // Lista achatada equipe-a-equipe, já na ordem final de disputa.
    const assignments = [];
    for (const category of categories) {
      for (const team of teamsByCategory[category.id] || []) {
        assignments.push({ team, category });
      }
    }

    // Time cap por categoria PRESENTE nesta prova — usado só pra saber quanto
    // tempo cada bateria dura (a bateria só termina quando o cap da
    // categoria mais lenta dentro dela expira).
    const variants = await queryAll('SELECT category_id, time_cap_seconds FROM workout_variants WHERE workout_id = $1', [
      workout_id,
    ]);
    const timeCapByCategory = new Map(variants.map((v) => [v.category_id, v.time_cap_seconds]));

    const existingResults = await queryOne(
      `SELECT COUNT(r.id)::int AS total
       FROM results r
       JOIN heat_teams ht ON ht.id = r.heat_team_id
       JOIN heats h ON h.id = ht.heat_id
       WHERE h.workout_id = $1`,
      [workout_id]
    );

    if (existingResults.total > 0 && !force) {
      return res.status(409).json({
        error: {
          code: 'RESULTS_EXIST',
          message:
            `Já existem ${existingResults.total} resultado(s) lançado(s) nesta prova. ` +
            `Regerar as baterias apagaria esses resultados. Envie force: true se for mesmo isso que você quer.`,
        },
      });
    }

    const chunks = chunkIntoHeats(assignments, lanes);

    const heatPlans = chunks.map((chunk) => {
      const categoryIds = [...new Set(chunk.map((a) => a.category.id))];
      const caps = categoryIds.map((id) => timeCapByCategory.get(id));
      const hasAllCaps = caps.every((c) => typeof c === 'number');
      return { lanesUsed: chunk, durationSeconds: hasAllCaps ? Math.max(...caps) : null };
    });

    // Âncora: continua de onde a última bateria já agendada no campeonato
    // (de QUALQUER prova) parou. Só cai pro início do campeonato se essa é a
    // primeira bateria com horário calculado do evento inteiro. Isso é o que
    // permite gerar prova por prova, em ordem, e sair com uma agenda contínua
    // o dia todo — sem coordenar manualmente entre provas.
    const previousAnchor = await queryOne(
      `SELECT MAX(h.scheduled_time + (h.duration_seconds || ' seconds')::interval) AS last_end
       FROM heats h
       JOIN workouts w ON w.id = h.workout_id
       WHERE w.championship_id = $1
         AND h.workout_id != $2
         AND h.scheduled_time IS NOT NULL
         AND h.duration_seconds IS NOT NULL`,
      [workout.championship_id, workout_id]
    );

    // O tempo de transição também vale entre a última bateria de uma prova e
    // a primeira da próxima — baterias são sequenciais no dia inteiro, não só
    // dentro da mesma prova. Sem somar aqui, gerar prova por prova comprimia
    // esse intervalo (bug encontrado testando: heat final do WOD1 terminava
    // e o heat inicial do WOD2 começava no mesmo instante, sem transição).
    let startCursor = null;
    if (previousAnchor.last_end) {
      startCursor = new Date(new Date(previousAnchor.last_end).getTime() + transitionSeconds * 1000);
    } else if (championship.start_time_str) {
      startCursor = new Date(`${championship.date_str}T${championship.start_time_str}`);
    }

    const schedule = computeHeatSchedule(heatPlans, { startCursor, transitionSeconds });

    await client.query('BEGIN');

    await client.query('DELETE FROM heats WHERE workout_id = $1', [workout_id]);

    const createdHeats = [];

    for (let i = 0; i < heatPlans.length; i += 1) {
      const heatNumber = i + 1;
      const plan = heatPlans[i];
      const { scheduledTime } = schedule[i];

      // eslint-disable-next-line no-await-in-loop
      const heat = await client.query(
        `INSERT INTO heats (workout_id, heat_number, scheduled_time, duration_seconds)
         VALUES ($1, $2, $3, $4)
         RETURNING id, workout_id, heat_number, scheduled_time, duration_seconds, status`,
        [workout_id, heatNumber, scheduledTime, plan.durationSeconds]
      );

      const heatRow = heat.rows[0];
      const lanesUsed = [];

      for (let laneIndex = 0; laneIndex < plan.lanesUsed.length; laneIndex += 1) {
        const { team, category } = plan.lanesUsed[laneIndex];
        const laneNumber = laneIndex + 1;

        // eslint-disable-next-line no-await-in-loop
        await client.query(
          `INSERT INTO heat_teams (heat_id, team_id, lane_number)
           VALUES ($1, $2, $3)`,
          [heatRow.id, team.id, laneNumber]
        );

        lanesUsed.push({
          lane_number: laneNumber,
          team_id: team.id,
          team_name: team.name,
          category_id: category.id,
          category_name: category.name,
        });
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
        categoriesIncluded: categories.map((c) => ({ id: c.id, name: c.name })),
        totalTeams: assignments.length,
        lanesPerHeat: lanes,
        heatsCreated: heatPlans.length,
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

// GET /api/workouts/:workout_id/heats  (público)
// Uma bateria não pertence mais a uma categoria só — cada raia carrega a
// categoria da equipe que está nela, não a bateria como um todo.
exports.getByWorkout = async (req, res, next) => {
  try {
    const { workout_id } = req.params;

    const workout = await queryOne('SELECT id FROM workouts WHERE id = $1', [workout_id]);

    if (!workout) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Prova não encontrada' },
      });
    }

    const heats = await queryAll(
      `SELECT id, workout_id, heat_number, scheduled_time, duration_seconds, status
       FROM heats
       WHERE workout_id = $1
       ORDER BY heat_number ASC`,
      [workout_id]
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
              c.id AS category_id, c.name AS category_name,
              r.id AS result_id, r."place", r.raw_value, r.did_not_finish
       FROM heat_teams ht
       JOIN teams t ON t.id = ht.team_id
       JOIN categories c ON c.id = t.category_id
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
       RETURNING id, workout_id, heat_number, scheduled_time, duration_seconds, status`,
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
