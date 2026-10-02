const { pool, query, queryOne, queryAll } = require('../config/database');
const { respondToPgError } = require('../utils/pgErrors');

/**
 * CRUD das tabelas de pontos do modelo `points_table` (migrations 011 e 012),
 * mais a pré-visualização.
 *
 * O CONTROLLER NÃO CALCULA PONTUAÇÃO
 * Nenhuma linha aqui sabe quanto vale o 3º lugar. Quem sabe é
 * points_for_place() no banco, e é de lá que a pré-visualização tira os
 * números — inclusive a posição em que a pontuação zera. Reimplementar a conta
 * em JS para "não ir ao banco" criaria uma segunda régua que pode divergir da
 * primeira, e o organizador veria na tela uma tabela diferente da que vale no
 * placar.
 *
 * VALIDAÇÃO DAS FAIXAS TAMBÉM NÃO
 * Que as faixas comecem na 1ª colocação, sejam contínuas e terminem numa faixa
 * aberta é verificado por constraint trigger no COMMIT (migration 012). O
 * controller só traduz o erro do banco para HTTP. As mensagens do trigger foram
 * escritas em português e voltadas ao usuário justamente para poderem ser
 * exibidas direto, sem uma segunda tabela de mensagens para manter em sincronia.
 */

const MAX_PLACES_PREVIEW = 500;

const carregarFaixas = (pointsTableId) =>
  queryAll(
    `SELECT id, start_place, end_place, decrement
       FROM points_table_ranges
      WHERE points_table_id = $1
      ORDER BY start_place ASC`,
    [pointsTableId]
  );

const championshipExiste = async (championshipId) =>
  Boolean(await queryOne('SELECT id FROM championships WHERE id = $1', [championshipId]));

/**
 * GET /api/championships/:championship_id/points-tables
 */
const list = async (req, res, next) => {
  try {
    const { championship_id } = req.params;

    if (!(await championshipExiste(championship_id))) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Campeonato não encontrado' },
      });
    }

    const tabelas = await queryAll(
      `SELECT id, championship_id, name, max_points, created_at, updated_at
         FROM points_tables
        WHERE championship_id = $1
        ORDER BY name ASC`,
      [championship_id]
    );

    // Uma consulta para todas as faixas em vez de uma por tabela: são poucas
    // tabelas por campeonato, mas N+1 em loop é hábito que escala mal e já
    // custou caro no heatController.
    const faixas = await queryAll(
      `SELECT r.id, r.points_table_id, r.start_place, r.end_place, r.decrement
         FROM points_table_ranges r
         JOIN points_tables pt ON pt.id = r.points_table_id
        WHERE pt.championship_id = $1
        ORDER BY r.points_table_id ASC, r.start_place ASC`,
      [championship_id]
    );

    const porTabela = faixas.reduce((acc, faixa) => {
      (acc[faixa.points_table_id] ||= []).push(faixa);
      return acc;
    }, {});

    res.status(200).json({
      data: tabelas.map((t) => ({ ...t, ranges: porTabela[t.id] || [] })),
      meta: { total: tabelas.length },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/championships/:championship_id/points-tables
 * body: { name, max_points?, ranges: [{ start_place, end_place, decrement }] }
 *
 * A tabela e as faixas entram na MESMA transação porque a validação é sobre o
 * conjunto: uma tabela sem faixas, ou com faixas pela metade, é um estado que
 * não deve nem chegar a existir.
 */
const create = async (req, res, next) => {
  const { championship_id } = req.params;
  const { name, max_points, ranges } = req.body;

  if (!(await championshipExiste(championship_id))) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Campeonato não encontrado' },
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const criada = await client.query(
      `INSERT INTO points_tables (championship_id, name, max_points)
       VALUES ($1, $2, COALESCE($3, 100))
       RETURNING id, championship_id, name, max_points, created_at, updated_at`,
      [championship_id, name, max_points ?? null]
    );
    const tabela = criada.rows[0];

    // INSERT em lote: um comando, não um por faixa.
    const valores = ranges
      .map((_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`)
      .join(', ');
    const params = [tabela.id];
    ranges.forEach((faixa) => {
      params.push(faixa.start_place, faixa.end_place ?? null, faixa.decrement);
    });
    await client.query(
      `INSERT INTO points_table_ranges (points_table_id, start_place, end_place, decrement)
       VALUES ${valores}`,
      params
    );

    // A constraint trigger é DEFERRED: se as faixas estiverem inconsistentes,
    // o erro estoura AQUI, no COMMIT, não no INSERT.
    await client.query('COMMIT');

    res.status(201).json({
      data: { ...tabela, ranges: await carregarFaixas(tabela.id) },
      meta: { message: 'Tabela de pontos criada' },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return respondToPgError(error, res, next);
  } finally {
    client.release();
  }
};

/**
 * PUT /api/championships/:championship_id/points-tables/:points_table_id
 * body: { name?, max_points?, ranges? }
 *
 * Mandar `ranges` SUBSTITUI todas as faixas. Não existe edição de faixa
 * individual de propósito: as faixas só fazem sentido como conjunto contínuo, e
 * um PATCH por faixa obrigaria o cliente a orquestrar uma sequência de
 * chamadas em que todo estado intermediário é inválido.
 *
 * Alterar qualquer coisa aqui reescreve o placar de todos os campeonatos que
 * usam esta tabela — o trigger do banco cuida disso, o controller não chama
 * recálculo nenhum.
 */
const update = async (req, res, next) => {
  const { championship_id, points_table_id } = req.params;
  const { name, max_points, ranges } = req.body;

  const tabela = await queryOne(
    'SELECT id, championship_id FROM points_tables WHERE id = $1',
    [points_table_id]
  );

  if (!tabela) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Tabela de pontos não encontrada' },
    });
  }

  if (Number(tabela.championship_id) !== Number(championship_id)) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'A tabela de pontos não pertence a este campeonato',
      },
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (name !== undefined || max_points !== undefined) {
      await client.query(
        `UPDATE points_tables
            SET name = COALESCE($2, name),
                max_points = COALESCE($3, max_points),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [points_table_id, name ?? null, max_points ?? null]
      );
    }

    if (ranges !== undefined) {
      await client.query('DELETE FROM points_table_ranges WHERE points_table_id = $1', [
        points_table_id,
      ]);

      const valores = ranges
        .map((_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`)
        .join(', ');
      const params = [points_table_id];
      ranges.forEach((faixa) => {
        params.push(faixa.start_place, faixa.end_place ?? null, faixa.decrement);
      });
      await client.query(
        `INSERT INTO points_table_ranges (points_table_id, start_place, end_place, decrement)
         VALUES ${valores}`,
        params
      );
    }

    await client.query('COMMIT');

    const atualizada = await queryOne(
      `SELECT id, championship_id, name, max_points, created_at, updated_at
         FROM points_tables WHERE id = $1`,
      [points_table_id]
    );

    res.status(200).json({
      data: { ...atualizada, ranges: await carregarFaixas(points_table_id) },
      meta: { message: 'Tabela de pontos atualizada' },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return respondToPgError(error, res, next);
  } finally {
    client.release();
  }
};

/**
 * DELETE /api/championships/:championship_id/points-tables/:points_table_id
 */
const remove = async (req, res, next) => {
  try {
    const { championship_id, points_table_id } = req.params;

    const tabela = await queryOne(
      'SELECT id, championship_id FROM points_tables WHERE id = $1',
      [points_table_id]
    );

    if (!tabela) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Tabela de pontos não encontrada' },
      });
    }

    if (Number(tabela.championship_id) !== Number(championship_id)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A tabela de pontos não pertence a este campeonato',
        },
      });
    }

    await query('DELETE FROM points_tables WHERE id = $1', [points_table_id]);

    res.status(200).json({ data: null, meta: { message: 'Tabela de pontos excluída' } });
  } catch (error) {
    return respondToPgError(error, res, next);
  }
};

/**
 * GET /api/championships/:championship_id/points-tables/:points_table_id/preview
 *
 * A tabela resultante, colocação por colocação, mais o aviso de zeragem.
 *
 * Existe porque salvar uma tabela de pontos REESCREVE o placar inteiro: o
 * organizador precisa ver o efeito antes, não depois. E porque "da posição 1 até
 * 3 decrescer 5 pontos" não deixa óbvio que o 4º lugar vale 87 — a virada de
 * faixa usa o decremento da faixa nova, e ninguém acerta isso de cabeça.
 */
const preview = async (req, res, next) => {
  try {
    const { championship_id, points_table_id } = req.params;

    const tabela = await queryOne(
      'SELECT id, championship_id, name, max_points FROM points_tables WHERE id = $1',
      [points_table_id]
    );

    if (!tabela) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Tabela de pontos não encontrada' },
      });
    }

    if (Number(tabela.championship_id) !== Number(championship_id)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A tabela de pontos não pertence a este campeonato',
        },
      });
    }

    // A maior categoria é a régua do que precisa ser mostrado: exibir até a 50ª
    // colocação num campeonato de 12 equipes é ruído, e parar na 10ª num de 34
    // esconde justamente a parte que interessa.
    const maiorCategoria = await queryOne(
      `SELECT c.id AS category_id, c.name AS category_name, COUNT(t.id)::int AS teams
         FROM categories c
         LEFT JOIN teams t ON t.category_id = c.id
        WHERE c.championship_id = $1
        GROUP BY c.id, c.name
        ORDER BY COUNT(t.id) DESC, c.id ASC
        LIMIT 1`,
      [championship_id]
    );

    const equipesNaMaior = maiorCategoria?.teams ?? 0;
    const solicitado = Number(req.query.places);
    const ate = Math.min(
      MAX_PLACES_PREVIEW,
      Number.isInteger(solicitado) && solicitado > 0
        ? solicitado
        : Math.max(10, equipesNaMaior)
    );

    const places = await queryAll(
      `SELECT g AS place, points_for_place($1, g)::int AS points
         FROM generate_series(1, $2) g
        ORDER BY g`,
      [points_table_id, ate]
    );

    // Onde a pontuação chega a zero. Busca até MAX_PLACES_PREVIEW e não
    // analiticamente: a conta é da função no banco, e duplicá-la aqui seria a
    // segunda régua que este arquivo justamente evita.
    const zeragem = await queryOne(
      `SELECT MIN(s.place)::int AS zeroes_at
         FROM (SELECT g AS place, points_for_place($1, g) AS points
                 FROM generate_series(1, $2) g) s
        WHERE s.points = 0`,
      [points_table_id, MAX_PLACES_PREVIEW]
    );

    const zeroesAt = zeragem?.zeroes_at ?? null;
    const zeraDentroDaCompeticao = zeroesAt !== null && equipesNaMaior >= zeroesAt;

    res.status(200).json({
      data: {
        points_table_id: Number(points_table_id),
        name: tabela.name,
        max_points: tabela.max_points,
        ranges: await carregarFaixas(points_table_id),
        places,
        zeroes_at: zeroesAt,
        largest_category: maiorCategoria ?? null,
      },
      meta: {
        // Informa, não bloqueia: zero é um resultado legítimo, só precisa ser
        // visível. Inscrição é o fluxo principal do organizador e pontuação é
        // configuração — travar o principal por causa do acessório sai caro.
        warning: zeraDentroDaCompeticao
          ? `A partir da ${zeroesAt}ª colocação a pontuação é zero, e a categoria ${maiorCategoria.category_name} tem ${equipesNaMaior} equipes.`
          : null,
      },
    });
  } catch (error) {
    return respondToPgError(error, res, next);
  }
};

/**
 * PUT /api/championships/:championship_id/scoring-model
 * body: { scoring_model, points_table_id?, confirm? }
 *
 * Trocar o modelo REESCREVE o placar de cima a baixo: onde antes a menor soma
 * de colocações liderava, passa a liderar a maior soma de pontos. Por isso o
 * 409 com contagem quando já existem resultados — mesmo padrão do
 * heatController ao regerar baterias, e pelo mesmo motivo: a operação é
 * legítima, mas quem a dispara sem saber o efeito se assusta com o resultado.
 *
 * Resultados brutos nunca são tocados. O recálculo é do trigger no banco; este
 * handler só muda a configuração do campeonato.
 */
const setScoringModel = async (req, res, next) => {
  try {
    const { championship_id } = req.params;
    const { scoring_model, points_table_id = null, confirm = false } = req.body;

    const campeonato = await queryOne(
      'SELECT id, scoring_model, points_table_id FROM championships WHERE id = $1',
      [championship_id]
    );

    if (!campeonato) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Campeonato não encontrado' },
      });
    }

    // A tabela alvo é a mandada agora ou a que o campeonato já tinha. O CHECK
    // no banco é a garantia final, mas checar aqui devolve mensagem melhor do
    // que a tradução genérica da constraint.
    const tabelaAlvo = points_table_id ?? campeonato.points_table_id;

    if (scoring_model === 'points_table') {
      if (!tabelaAlvo) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'Para usar a pontuação estilo CrossFit Games é preciso escolher uma tabela de pontos.',
          },
        });
      }

      const tabela = await queryOne(
        'SELECT id, championship_id FROM points_tables WHERE id = $1',
        [tabelaAlvo]
      );

      if (!tabela) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Tabela de pontos não encontrada' },
        });
      }

      if (Number(tabela.championship_id) !== Number(championship_id)) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'A tabela de pontos não pertence a este campeonato',
          },
        });
      }
    }

    const semMudanca =
      campeonato.scoring_model === scoring_model &&
      Number(campeonato.points_table_id ?? 0) === Number(tabelaAlvo ?? 0);

    const { total } = await queryOne(
      `SELECT COUNT(*)::int AS total
         FROM results r
         JOIN heat_teams ht ON ht.id = r.heat_team_id
         JOIN heats h ON h.id = ht.heat_id
         JOIN workouts w ON w.id = h.workout_id
        WHERE w.championship_id = $1`,
      [championship_id]
    );

    if (total > 0 && !confirm && !semMudanca) {
      return res.status(409).json({
        error: {
          code: 'RESULTS_EXIST',
          message:
            `Este campeonato já tem ${total} resultado(s) lançado(s). ` +
            `Trocar a pontuação recalcula o placar inteiro (os resultados em si não são apagados). ` +
            `Envie confirm: true se for mesmo isso que você quer.`,
        },
      });
    }

    await query(
      `UPDATE championships
          SET scoring_model = $2,
              points_table_id = $3,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [championship_id, scoring_model, scoring_model === 'points_table' ? tabelaAlvo : (points_table_id ?? campeonato.points_table_id)]
    );

    const atualizado = await queryOne(
      'SELECT id, name, scoring_model, points_table_id FROM championships WHERE id = $1',
      [championship_id]
    );

    res.status(200).json({
      data: atualizado,
      meta: {
        message:
          scoring_model === 'points_table'
            ? 'Campeonato usando pontuação estilo CrossFit Games'
            : 'Campeonato usando pontuação padrão (soma de colocações)',
        recalculated_results: total,
      },
    });
  } catch (error) {
    return respondToPgError(error, res, next);
  }
};

/**
 * POST /api/championships/:championship_id/points-tables/preview
 * body: { ranges, max_points? }
 *
 * Pré-visualização de RASCUNHO: calcula a tabela sem salvar nada.
 *
 * Existe porque a pré-visualização só cumpre seu papel se acontecer ANTES de
 * salvar — e salvar a tabela que o campeonato está usando reescreve o placar
 * inteiro. Mostrar o efeito depois do estrago não ajuda ninguém.
 *
 * Como funciona: abre transação, grava uma tabela temporária, pede os números
 * à MESMA points_for_place() de sempre e desfaz tudo. O `SET CONSTRAINTS ALL
 * IMMEDIATE` força a validação das faixas a rodar aqui dentro, em vez de no
 * commit que nunca vai acontecer — então o rascunho é validado igual ao
 * definitivo.
 *
 * A alternativa seria refazer a aritmética em JS ou numa query própria. Seria
 * mais curto e seria uma segunda régua: no dia em que a regra mudasse, a
 * pré-visualização passaria a mentir, e ninguém descobriria até o placar sair
 * diferente do que a tela prometeu.
 */
const previewDraft = async (req, res, next) => {
  const { championship_id } = req.params;
  const { ranges, max_points } = req.body;

  if (!(await championshipExiste(championship_id))) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Campeonato não encontrado' },
    });
  }

  const maiorCategoria = await queryOne(
    `SELECT c.id AS category_id, c.name AS category_name, COUNT(t.id)::int AS teams
       FROM categories c
       LEFT JOIN teams t ON t.category_id = c.id
      WHERE c.championship_id = $1
      GROUP BY c.id, c.name
      ORDER BY COUNT(t.id) DESC, c.id ASC
      LIMIT 1`,
    [championship_id]
  );

  const equipesNaMaior = maiorCategoria?.teams ?? 0;
  const solicitado = Number(req.body.places);
  const ate = Math.min(
    MAX_PLACES_PREVIEW,
    Number.isInteger(solicitado) && solicitado > 0 ? solicitado : Math.max(10, equipesNaMaior)
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const temporaria = await client.query(
      `INSERT INTO points_tables (championship_id, name, max_points)
       VALUES ($1, $2, COALESCE($3, 100)) RETURNING id, max_points`,
      [championship_id, `__preview_${Date.now()}_${Math.random().toString(36).slice(2)}`, max_points ?? null]
    );
    const tabelaId = temporaria.rows[0].id;

    const valores = ranges
      .map((_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`)
      .join(', ');
    const params = [tabelaId];
    ranges.forEach((faixa) => {
      params.push(faixa.start_place, faixa.end_place ?? null, faixa.decrement);
    });
    await client.query(
      `INSERT INTO points_table_ranges (points_table_id, start_place, end_place, decrement)
       VALUES ${valores}`,
      params
    );

    // Antecipa a constraint trigger deferida: sem isso ela só rodaria no
    // COMMIT, que aqui nunca acontece, e um rascunho inválido passaria.
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');

    const places = await client.query(
      `SELECT g AS place, points_for_place($1, g)::int AS points
         FROM generate_series(1, $2) g ORDER BY g`,
      [tabelaId, ate]
    );

    const zeragem = await client.query(
      `SELECT MIN(s.place)::int AS zeroes_at
         FROM (SELECT g AS place, points_for_place($1, g) AS points
                 FROM generate_series(1, $2) g) s
        WHERE s.points = 0`,
      [tabelaId, MAX_PLACES_PREVIEW]
    );

    const zeroesAt = zeragem.rows[0]?.zeroes_at ?? null;

    await client.query('ROLLBACK');

    const zeraDentroDaCompeticao = zeroesAt !== null && equipesNaMaior >= zeroesAt;

    res.status(200).json({
      data: {
        points_table_id: null,
        name: null,
        max_points: temporaria.rows[0].max_points,
        ranges,
        places: places.rows,
        zeroes_at: zeroesAt,
        largest_category: maiorCategoria ?? null,
      },
      meta: {
        draft: true,
        warning: zeraDentroDaCompeticao
          ? `A partir da ${zeroesAt}ª colocação a pontuação é zero, e a categoria ${maiorCategoria.category_name} tem ${equipesNaMaior} equipes.`
          : null,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return respondToPgError(error, res, next);
  } finally {
    client.release();
  }
};

module.exports = { list, create, update, remove, preview, previewDraft, setScoringModel };
