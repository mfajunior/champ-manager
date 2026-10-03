const { pool, queryOne, queryAll } = require('../config/database');
const { fetchStandings } = require('../models/standings');
const { rescheduleChampionship } = require('../models/schedule');

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
 * DISTRIBUI, NÃO FATIA
 *
 * A versão anterior cortava a lista de `lanesPerHeat` em `lanesPerHeat` e
 * documentava a sobra como inevitável. Não é: 29 equipes em 4 raias fatiadas
 * assim dão sete baterias de 4 e uma de UMA — uma dupla sozinha no ginásio,
 * com três raias vazias ao lado, enquanto todas as outras competiram em
 * bateria cheia.
 *
 * O número de baterias é o mesmo nos dois casos (teto de total/raias); o que
 * muda é como as equipes se espalham por ele. Com 29 e 4 raias são 8 baterias
 * de qualquer jeito, e distribuir dá 5 de 4 e 3 de 3 — ninguém sozinho.
 *
 * Isso não é só estética. Em CrossFit o tamanho da bateria afeta o resultado:
 * atleta puxa ritmo de quem está do lado. Bateria de 1 contra baterias de 4 é
 * desvantagem competitiva, e cai sempre na última equipe da última categoria,
 * que não escolheu estar ali.
 *
 * A ORDEM É PRESERVADA. A lista chega pronta (nível -> gênero, achatada
 * equipe-a-equipe) e esta função nunca reordena — só decide onde cortar.
 */
const chunkIntoHeats = (assignments, lanesPerHeat) => {
  if (assignments.length === 0) return [];

  const totalBaterias = Math.ceil(assignments.length / lanesPerHeat);
  const base = Math.floor(assignments.length / totalBaterias);
  // As primeiras `resto` baterias levam uma equipe a mais. base + 1 nunca
  // passa de lanesPerHeat: se passasse, base seria igual a lanesPerHeat, o que
  // só acontece quando a divisão é exata — e aí resto é zero.
  const resto = assignments.length % totalBaterias;

  const chunks = [];
  let i = 0;
  for (let b = 0; b < totalBaterias; b += 1) {
    const tamanho = base + (b < resto ? 1 : 0);
    chunks.push(assignments.slice(i, i + tamanho));
    i += tamanho;
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

/**
 * Recalcula a duração das baterias afetadas por um remanejamento.
 *
 * A duração de uma bateria é o MAIOR time cap entre as categorias presentes
 * nela — é isso que faz uma bateria mista durar o que a categoria mais lenta
 * precisa. Mover uma equipe entre baterias pode, portanto, mudar a duração das
 * duas: tirar a única equipe de RX de uma bateria encurta ela, e colocá-la na
 * outra alonga aquela.
 *
 * Se qualquer categoria presente não tem time cap cadastrado para a prova, a
 * duração vira NULL — o mesmo critério do gerador. Sem saber quanto a bateria
 * dura, não dá para saber quando a próxima começa.
 */
const recalcularDuracoes = async (client, heatIds) => {
  if (heatIds.length === 0) return;
  await client.query(
    `UPDATE heats h
        SET duration_seconds = sub.duracao
       FROM (
         SELECT ht.heat_id,
                CASE WHEN bool_and(wv.time_cap_seconds IS NOT NULL)
                     THEN MAX(wv.time_cap_seconds) END AS duracao
           FROM heat_teams ht
           JOIN teams t ON t.id = ht.team_id
           JOIN heats h2 ON h2.id = ht.heat_id
           LEFT JOIN workout_variants wv
                  ON wv.workout_id = h2.workout_id
                 AND wv.category_id = t.category_id
          WHERE ht.heat_id = ANY($1::int[])
          GROUP BY ht.heat_id
       ) sub
      WHERE h.id = sub.heat_id`,
    [heatIds]
  );
};

/** Carrega a raia com o contexto que as duas operações precisam validar. */
const carregarRaia = (client, heatTeamId) =>
  client
    .query(
      `SELECT ht.id, ht.heat_id, ht.team_id, ht.lane_number,
              t.name AS team_name,
              h.workout_id, h.heat_number,
              w.championship_id,
              c.lanes_per_heat
         FROM heat_teams ht
         JOIN teams t ON t.id = ht.team_id
         JOIN heats h ON h.id = ht.heat_id
         JOIN workouts w ON w.id = h.workout_id
         JOIN championships c ON c.id = w.championship_id
        WHERE ht.id = $1`,
      [heatTeamId]
    )
    .then((r) => r.rows[0] || null);

// POST /api/heats/lanes/swap  (protegido)
// body: { heat_team_id_a, heat_team_id_b }
//
// Troca duas equipes de lugar. É a operação segura por construção: o tamanho
// de cada bateria não muda, nenhuma raia fica duplicada no fim, e nenhuma
// equipe fica sem lugar. Qualquer rearranjo que preserve os tamanhos das
// baterias é alcançável por uma sequência de trocas.
//
// RESULTADO JÁ LANÇADO NÃO ATRAPALHA. results aponta para heat_team_id, e a
// bateria é uma coluna DENTRO dessa linha — trocar o heat_id leva o resultado
// junto, sem nada para migrar. E a colocação é por prova, não por bateria,
// então ela não muda: a equipe continua tendo feito o mesmo tempo.
exports.swapLanes = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { heat_team_id_a: idA, heat_team_id_b: idB } = req.body;

    if (!idA || !idB) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'heat_team_id_a e heat_team_id_b são obrigatórios' },
      });
    }
    if (Number(idA) === Number(idB)) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'As duas raias precisam ser diferentes' },
      });
    }

    await client.query('BEGIN');

    const a = await carregarRaia(client, idA);
    const b = await carregarRaia(client, idB);

    if (!a || !b) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Raia não encontrada' },
      });
    }

    // Trocar equipes entre PROVAS diferentes não significa nada: cada prova
    // tem as próprias baterias, e a equipe já está escalada nas duas.
    if (a.workout_id !== b.workout_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'As duas raias precisam ser da mesma prova',
        },
      });
    }

    // Sem isto, trocar duas equipes que já estão na mesma bateria colidiria
    // com UNIQUE(heat_id, team_id) — ou, pior, passaria e não faria nada.
    if (a.heat_id !== b.heat_id) {
      const jaEstao = await client.query(
        `SELECT 1 FROM heat_teams
          WHERE (heat_id = $1 AND team_id = $2) OR (heat_id = $3 AND team_id = $4)`,
        [b.heat_id, a.team_id, a.heat_id, b.team_id]
      );
      if (jaEstao.rowCount > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'Uma das equipes já está escalada na bateria de destino',
          },
        });
      }
    }

    // A troca passa por um estado inválido no meio — ao mover a primeira, a
    // segunda ainda ocupa o destino. Adiar a checagem para o COMMIT é o que
    // torna isso possível sem valores temporários (ver migration 016).
    await client.query('SET CONSTRAINTS uq_heat_teams_lane DEFERRED');

    await client.query('UPDATE heat_teams SET heat_id = $1, lane_number = $2 WHERE id = $3', [
      b.heat_id,
      b.lane_number,
      a.id,
    ]);
    await client.query('UPDATE heat_teams SET heat_id = $1, lane_number = $2 WHERE id = $3', [
      a.heat_id,
      a.lane_number,
      b.id,
    ]);

    const afetadas = [...new Set([a.heat_id, b.heat_id])];
    await recalcularDuracoes(client, afetadas);
    await rescheduleChampionship(client, a.championship_id);

    await client.query('COMMIT');

    res.status(200).json({
      data: null,
      meta: {
        message:
          `"${a.team_name}" e "${b.team_name}" trocaram de lugar ` +
          `(baterias ${a.heat_number} e ${b.heat_number}).`,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

// PUT /api/heats/lanes/:heat_team_id  (protegido)
// body: { heat_id, lane_number }
//
// Move uma equipe para uma raia LIVRE de outra bateria. A troca não cobre este
// caso: com a distribuição equilibrada as baterias têm tamanhos diferentes
// (4 e 3), e tirar uma equipe da cheia para a que tem raia sobrando é
// exatamente o ajuste que o organizador faz no dia.
exports.moveLane = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { heat_team_id: heatTeamId } = req.params;
    const { heat_id: destinoHeatId, lane_number: destinoLane } = req.body;

    if (!destinoHeatId || !destinoLane) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'heat_id e lane_number são obrigatórios' },
      });
    }

    await client.query('BEGIN');

    const raia = await carregarRaia(client, heatTeamId);
    if (!raia) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Raia não encontrada' } });
    }

    const destino = await client.query(
      'SELECT id, workout_id, heat_number FROM heats WHERE id = $1',
      [destinoHeatId]
    );
    if (destino.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Bateria de destino não encontrada' } });
    }
    if (destino.rows[0].workout_id !== raia.workout_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'A bateria de destino precisa ser da mesma prova' },
      });
    }

    if (destinoLane < 1 || destinoLane > raia.lanes_per_heat) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `O box tem ${raia.lanes_per_heat} raias; lane_number precisa estar entre 1 e ${raia.lanes_per_heat}`,
        },
      });
    }

    const ocupada = await client.query(
      'SELECT t.name FROM heat_teams ht JOIN teams t ON t.id = ht.team_id WHERE ht.heat_id = $1 AND ht.lane_number = $2 AND ht.id <> $3',
      [destinoHeatId, destinoLane, raia.id]
    );
    if (ocupada.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: `A raia ${destinoLane} já é de "${ocupada.rows[0].name}". Use a troca para inverter as duas.`,
        },
      });
    }

    const jaEsta = await client.query(
      'SELECT 1 FROM heat_teams WHERE heat_id = $1 AND team_id = $2 AND id <> $3',
      [destinoHeatId, raia.team_id, raia.id]
    );
    if (jaEsta.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: { code: 'CONFLICT', message: 'A equipe já está escalada nessa bateria' },
      });
    }

    await client.query('UPDATE heat_teams SET heat_id = $1, lane_number = $2 WHERE id = $3', [
      destinoHeatId,
      destinoLane,
      raia.id,
    ]);

    const afetadas = [...new Set([raia.heat_id, Number(destinoHeatId)])];
    await recalcularDuracoes(client, afetadas);
    await rescheduleChampionship(client, raia.championship_id);

    await client.query('COMMIT');

    res.status(200).json({
      data: null,
      meta: {
        message: `"${raia.team_name}" foi para a bateria ${destino.rows[0].heat_number}, raia ${destinoLane}.`,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

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
    const { force = false, order_by_standings = false } = req.body;

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

    // CORTE POR PROVA
    //
    // Quando a prova tem corte configurado ("só o top 4 disputa"), apenas as
    // classificadas entram nas baterias. Quem decide quem passa é
    // eligible_teams_for_workout no banco (migration 012) — a MESMA função que
    // a tela de cortes consulta. Se este controller tivesse a própria noção de
    // "top 4", ela divergiria da mostrada ao organizador no primeiro empate, e
    // ele veria uma lista na tela e outra na raia.
    //
    // A consulta só acontece quando existe corte. Sem corte, o caminho é
    // exatamente o de antes: este é o endpoint mais arriscado do backend e
    // não é hora de mudar o comportamento de quem não pediu nada.
    const corteConfigurado = await queryOne(
      'SELECT 1 AS existe FROM workout_cuts WHERE workout_id = $1 LIMIT 1',
      [workout_id]
    );

    if (corteConfigurado) {
      // Uma query para todas as categorias, via LATERAL, em vez de uma
      // chamada por categoria dentro de um loop.
      const classificadas = await queryAll(
        `SELECT c.id AS category_id, e AS team_id
           FROM categories c
           CROSS JOIN LATERAL eligible_teams_for_workout($1, c.id) e
          WHERE c.championship_id = $2`,
        [workout_id, workout.championship_id]
      );

      const permitidasPorCategoria = classificadas.reduce((acc, linha) => {
        (acc[linha.category_id] ||= new Set()).add(Number(linha.team_id));
        return acc;
      }, {});

      for (const categoryId of Object.keys(teamsByCategory)) {
        const permitidas = permitidasPorCategoria[categoryId] || new Set();
        teamsByCategory[categoryId] = teamsByCategory[categoryId].filter((team) =>
          permitidas.has(Number(team.id))
        );
      }
    }

    // ORDEM DE DISPUTA DENTRO DE CADA CATEGORIA
    //
    // Por padrão é o id da equipe — ordem de cadastro, que não significa
    // nada além de ser estável e previsível.
    //
    // Com order_by_standings, passa a ser a colocação atual no leaderboard,
    // do PIOR para o MELHOR: quem lidera compete nas últimas baterias. É
    // como campeonato de verdade organiza a disputa — a bateria final junta
    // os primeiros colocados, e a decisão acontece na frente de todo mundo,
    // em vez de já estar definida antes da última bateria começar.
    //
    // A ordenação é por categoria, nunca global, porque a colocação também
    // é por categoria (migration 002): o 1º de Iniciante e o 1º de RX têm o
    // mesmo place, e compará-los não diria nada.
    //
    // Equipe sem colocação — ainda não pontuou, ou é a primeira prova do
    // campeonato — vai pro começo. E se NINGUÉM pontuou ainda, todas caem no
    // desempate por id e o resultado é idêntico à ordem padrão: a opção não
    // quebra a primeira prova, simplesmente não tem efeito nela.
    let placePorEquipe = null;
    if (order_by_standings === true) {
      const standings = await fetchStandings(workout.championship_id);
      placePorEquipe = new Map(standings.map((linha) => [linha.team_id, linha.place]));
    }

    const doPiorParaOMelhor = (a, b) => {
      const placeA = placePorEquipe.get(a.id) ?? null;
      const placeB = placePorEquipe.get(b.id) ?? null;
      if (placeA === placeB) return a.id - b.id;
      if (placeA === null) return -1;
      if (placeB === null) return 1;
      return placeB - placeA; // place maior = pior colocado = compete antes
    };

    // Lista achatada equipe-a-equipe, já na ordem final de disputa.
    const assignments = [];
    for (const category of categories) {
      const equipes = teamsByCategory[category.id] || [];
      if (placePorEquipe) {
        equipes.sort(doPiorParaOMelhor);
      }
      for (const team of equipes) {
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

    // O corte pode ter deixado a prova sem ninguém (top N maior que zero, mas
    // nenhuma equipe pontuou ainda, ou cortes empilhados). Melhor dizer isso
    // do que gerar zero baterias em silêncio e o organizador descobrir na hora.
    if (assignments.length === 0) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: corteConfigurado
            ? 'O corte configurado não deixou nenhuma equipe classificada para esta prova.'
            : 'Nenhuma equipe registrada neste campeonato',
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

    // O horário de cada bateria não é decidido aqui. Depois de gravar as
    // baterias, a agenda do campeonato INTEIRO é recalculada em
    // models/schedule.js, na ordem das provas — é o que faz a prova 1 começar
    // na hora configurada e as seguintes se ajustarem quando ela muda de
    // tamanho, independentemente da ordem em que foram geradas.

    await client.query('BEGIN');

    await client.query('DELETE FROM heats WHERE workout_id = $1', [workout_id]);

    const createdHeats = [];

    for (let i = 0; i < heatPlans.length; i += 1) {
      const heatNumber = i + 1;
      const plan = heatPlans[i];

      // eslint-disable-next-line no-await-in-loop
      const heat = await client.query(
        `INSERT INTO heats (workout_id, heat_number, scheduled_time, duration_seconds)
         VALUES ($1, $2, $3, $4)
         RETURNING id, workout_id, heat_number,
                   to_char(scheduled_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_time,
                   duration_seconds, status`,
        // scheduled_time entra nulo: quem preenche é rescheduleChampionship
        // abaixo, ainda dentro desta transação.
        [workout_id, heatNumber, null, plan.durationSeconds]
      );

      const heatRow = heat.rows[0];

      const lanesUsed = plan.lanesUsed.map(({ team, category }, laneIndex) => ({
        lane_number: laneIndex + 1,
        team_id: team.id,
        team_name: team.name,
        category_id: category.id,
        category_name: category.name,
      }));

      // Um INSERT com todas as raias da bateria, em vez de um por raia: numa
      // prova de 40 equipes eram 40 idas ao banco dentro da transação, todas
      // em sequência. chunkIntoHeats nunca devolve bateria vazia (o slice só
      // roda enquanto há equipe sobrando), então a lista de VALUES sempre tem
      // ao menos uma linha.
      const laneValues = lanesUsed.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(', ');
      const laneParams = [heatRow.id];
      lanesUsed.forEach((lane) => laneParams.push(lane.team_id, lane.lane_number));

      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO heat_teams (heat_id, team_id, lane_number) VALUES ${laneValues}`,
        laneParams
      );

      createdHeats.push({
        ...heatRow,
        teams: lanesUsed,
        lanes_used: lanesUsed.length,
        lanes_empty: lanes - lanesUsed.length,
      });
    }

    // Reagenda o campeonato inteiro, não só esta prova: mudar o tamanho de uma
    // prova empurra todas as seguintes.
    await rescheduleChampionship(client, workout.championship_id);

    // Relê os horários recém-calculados — createdHeats foi montado antes do
    // reagendamento e teria scheduled_time nulo na resposta.
    const { rows: horarios } = await client.query(
      `SELECT id, to_char(scheduled_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_time
         FROM heats WHERE workout_id = $1`,
      [workout_id]
    );
    const horarioPorBateria = new Map(horarios.map((h) => [h.id, h.scheduled_time]));
    createdHeats.forEach((h) => {
      h.scheduled_time = horarioPorBateria.get(h.id) ?? null;
    });

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
        orderedByStandings: order_by_standings === true,
        cutApplied: Boolean(corteConfigurado),
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
      `SELECT id, workout_id, heat_number,
              to_char(scheduled_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_time,
              duration_seconds, status
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
      // DOIS JOINS, UM POR PONTUAÇÃO (migration 014)
      //
      // Um LEFT JOIN simples em results devolveria DUAS linhas por raia numa
      // prova de duas pontuações, e a tela mostraria a equipe duplicada. Os
      // joins são separados por score_index para que cada raia continue sendo
      // uma linha só, agora carregando os dois resultados.
      //
      // Os campos da primeira pontuação mantêm os nomes de sempre
      // (result_id, place, raw_value, did_not_finish), então quem só lida com
      // prova de pontuação única não percebe diferença.
      `SELECT ht.id AS heat_team_id, ht.heat_id, ht.lane_number, ht.team_id, t.name AS team_name,
              c.id AS category_id, c.name AS category_name,
              r1.id AS result_id, r1."place", r1.raw_value, r1.did_not_finish,
              r1.tiebreak_seconds,
              r2.id AS result_id_2, r2."place" AS place_2, r2.raw_value AS raw_value_2,
              r2.did_not_finish AS did_not_finish_2
       FROM heat_teams ht
       JOIN teams t ON t.id = ht.team_id
       JOIN categories c ON c.id = t.category_id
       LEFT JOIN results r1 ON r1.heat_team_id = ht.id AND r1.score_index = 1
       LEFT JOIN results r2 ON r2.heat_team_id = ht.id AND r2.score_index = 2
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
       RETURNING id, workout_id, heat_number,
                   to_char(scheduled_time, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_time,
                   duration_seconds, status`,
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
