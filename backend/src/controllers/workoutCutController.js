const { pool, query, queryOne, queryAll } = require('../config/database');
const { respondToPgError } = require('../utils/pgErrors');

/**
 * Corte por prova: "a prova 5 é disputada só pelo top 4".
 *
 * O top N conta DENTRO de cada categoria — os leaderboards já são
 * independentes por divisão desde a migration 002, e um corte global
 * eliminaria uma categoria pequena inteira. `category_id` nulo é a linha
 * padrão, válida para todas as divisões; uma linha com categoria preenchida
 * sobrescreve a padrão naquela divisão.
 *
 * QUEM DECIDE QUEM PASSA É O BANCO
 * A classificação sai de eligible_teams_for_workout() (migration 012), que
 * ordena pelo acumulado nas provas ANTERIORES. Este controller não ordena
 * nada: se ordenasse, existiriam duas noções de "top 4" — a da tela e a que
 * o heatController usa para montar as baterias — e elas divergiriam no
 * primeiro empate.
 */

const carregarProva = (workoutId) =>
  queryOne(
    `SELECT w.id, w.championship_id, w.workout_number, w.name
       FROM workouts w WHERE w.id = $1`,
    [workoutId]
  );

/**
 * GET /api/workouts/:workout_id/cut
 */
const get = async (req, res, next) => {
  try {
    const { workout_id } = req.params;

    const prova = await carregarProva(workout_id);
    if (!prova) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Prova não encontrada' },
      });
    }

    const cortes = await queryAll(
      `SELECT wc.id, wc.workout_id, wc.category_id, c.name AS category_name, wc.keep_top_n
         FROM workout_cuts wc
         LEFT JOIN categories c ON c.id = wc.category_id
        WHERE wc.workout_id = $1
        ORDER BY (wc.category_id IS NULL) DESC, c.id ASC`,
      [workout_id]
    );

    res.status(200).json({ data: cortes, meta: { total: cortes.length } });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/workouts/:workout_id/cut
 * body: { keep_top_n, category_id? }
 *
 * DELETE + INSERT em vez de ON CONFLICT: a unicidade é garantida por dois
 * índices PARCIAIS (um para a linha padrão, outro para as específicas, porque
 * o Postgres trata NULLs como distintos num UNIQUE comum), e ON CONFLICT
 * precisaria inferir qual dos dois — dois caminhos de código para economizar
 * um DELETE que custa nada.
 *
 * Salvar aqui reescreve o placar: o trigger do banco recalcula quem está
 * dentro e fora. O controller não chama recálculo nenhum.
 */
const upsert = async (req, res, next) => {
  const { workout_id } = req.params;
  const { keep_top_n, category_id = null } = req.body;

  const prova = await carregarProva(workout_id);
  if (!prova) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Prova não encontrada' },
    });
  }

  if (category_id !== null) {
    const categoria = await queryOne(
      'SELECT id, championship_id FROM categories WHERE id = $1',
      [category_id]
    );
    if (!categoria) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Categoria não encontrada' },
      });
    }
    if (Number(categoria.championship_id) !== Number(prova.championship_id)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A categoria não pertence ao campeonato desta prova',
        },
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      category_id === null
        ? 'DELETE FROM workout_cuts WHERE workout_id = $1 AND category_id IS NULL'
        : 'DELETE FROM workout_cuts WHERE workout_id = $1 AND category_id = $2',
      category_id === null ? [workout_id] : [workout_id, category_id]
    );

    const criado = await client.query(
      `INSERT INTO workout_cuts (workout_id, category_id, keep_top_n)
       VALUES ($1, $2, $3)
       RETURNING id, workout_id, category_id, keep_top_n, created_at`,
      [workout_id, category_id, keep_top_n]
    );

    await client.query('COMMIT');

    res.status(200).json({
      data: criado.rows[0],
      meta: {
        message:
          category_id === null
            ? `Prova disputada apenas pelo top ${keep_top_n} de cada categoria`
            : `Prova disputada apenas pelo top ${keep_top_n} nesta categoria`,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return respondToPgError(error, res, next);
  } finally {
    client.release();
  }
};

/**
 * DELETE /api/workouts/:workout_id/cut?category_id=N
 * Sem category_id remove a linha padrão.
 */
const remove = async (req, res, next) => {
  try {
    const { workout_id } = req.params;
    const categoryId = req.query.category_id ? Number(req.query.category_id) : null;

    const prova = await carregarProva(workout_id);
    if (!prova) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Prova não encontrada' },
      });
    }

    const apagados = await query(
      categoryId === null
        ? 'DELETE FROM workout_cuts WHERE workout_id = $1 AND category_id IS NULL'
        : 'DELETE FROM workout_cuts WHERE workout_id = $1 AND category_id = $2',
      categoryId === null ? [workout_id] : [workout_id, categoryId]
    );

    if (apagados.rowCount === 0) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Não havia corte configurado para esta prova' },
      });
    }

    res.status(200).json({ data: null, meta: { message: 'Corte removido' } });
  } catch (error) {
    return respondToPgError(error, res, next);
  }
};

/**
 * GET /api/workouts/:workout_id/eligible-teams
 *
 * Quem disputa a prova, por categoria — e se as baterias já geradas ainda
 * batem com essa lista.
 *
 * O `outdated` existe por causa de uma decisão consciente: corrigir um
 * resultado digitado errado recalcula o corte na hora (opção A). Isso é o
 * certo para o placar, mas as baterias montadas ANTES da correção continuam
 * com a escalação antiga. O sistema não mexe nelas sozinho — trocar quem
 * entra na bateria sem o organizador mandar é pior que a divergência. Então
 * ele avisa, e quem decide regerar é uma pessoa.
 */
const eligibleTeams = async (req, res, next) => {
  try {
    const { workout_id } = req.params;

    const prova = await carregarProva(workout_id);
    if (!prova) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Prova não encontrada' },
      });
    }

    const categorias = await queryAll(
      'SELECT id, name FROM categories WHERE championship_id = $1 ORDER BY id ASC',
      [prova.championship_id]
    );

    const cortes = await queryAll(
      'SELECT category_id, keep_top_n FROM workout_cuts WHERE workout_id = $1',
      [workout_id]
    );
    const cortePadrao = cortes.find((c) => c.category_id === null) || null;
    const cortePorCategoria = new Map(
      cortes.filter((c) => c.category_id !== null).map((c) => [c.category_id, c.keep_top_n])
    );

    // Quem está escalado hoje nas baterias desta prova.
    const escalados = await queryAll(
      `SELECT t.id AS team_id, t.name AS team_name, t.category_id
         FROM heat_teams ht
         JOIN heats h ON h.id = ht.heat_id
         JOIN teams t ON t.id = ht.team_id
        WHERE h.workout_id = $1`,
      [workout_id]
    );
    const escaladosPorCategoria = escalados.reduce((acc, linha) => {
      (acc[linha.category_id] ||= []).push(linha);
      return acc;
    }, {});

    const data = [];
    for (const categoria of categorias) {
      // eslint-disable-next-line no-await-in-loop
      const elegiveis = await queryAll(
        `SELECT e AS team_id, t.name AS team_name
           FROM eligible_teams_for_workout($1, $2) e
           JOIN teams t ON t.id = e
          ORDER BY t.name ASC`,
        [workout_id, categoria.id]
      );

      const naBateria = escaladosPorCategoria[categoria.id] || [];
      const idsElegiveis = new Set(elegiveis.map((l) => Number(l.team_id)));
      const idsEscalados = new Set(naBateria.map((l) => Number(l.team_id)));

      const divergente =
        naBateria.length > 0 &&
        (idsElegiveis.size !== idsEscalados.size ||
          [...idsElegiveis].some((id) => !idsEscalados.has(id)));

      data.push({
        category_id: categoria.id,
        category_name: categoria.name,
        keep_top_n:
          cortePorCategoria.get(categoria.id) ?? cortePadrao?.keep_top_n ?? null,
        eligible: elegiveis,
        scheduled: naBateria.map(({ team_id, team_name }) => ({ team_id, team_name })),
        outdated: divergente,
      });
    }

    res.status(200).json({
      data,
      meta: {
        workout_number: prova.workout_number,
        // O frontend usa isto para o aviso na tela de baterias (com o botão
        // de regerar ao lado), sem precisar varrer as categorias.
        any_outdated: data.some((c) => c.outdated),
      },
    });
  } catch (error) {
    return respondToPgError(error, res, next);
  }
};

module.exports = { get, upsert, remove, eligibleTeams };
