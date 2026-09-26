/**
 * A agenda do dia: que horas cada bateria começa.
 *
 * COMO ERA, E POR QUE NÃO FUNCIONAVA
 *
 * Ao gerar as baterias de uma prova, o controller procurava a ÚLTIMA bateria
 * já agendada de QUALQUER outra prova e continuava dali. Isso resolvia o caso
 * feliz — gerar prova 1, depois 2, depois 3 — e falhava nos outros dois, que
 * acontecem em qualquer evento real:
 *
 *   1. ORDEM. Gerar a prova 2 antes da 1 fazia a 2 começar às 08:00 e a 1 ser
 *      agendada DEPOIS dela. A âncora era "a última bateria existente", sem
 *      olhar o número da prova.
 *
 *   2. PROPAGAÇÃO. Regerar a prova 1 com mais equipes cria mais baterias e
 *      empurra o fim dela para frente — mas as provas 2 e 3 mantinham os
 *      horários antigos. O dia ficava com sobreposição, e em silêncio: nada
 *      na tela dizia que os horários tinham deixado de fazer sentido.
 *
 * COMO É AGORA
 *
 * A agenda inteira do campeonato é recalculada do zero a cada mudança, na
 * ordem das provas (workout_number) e das baterias dentro de cada prova. A
 * prova 1 começa na hora de início configurada; cada bateria seguinte começa
 * quando a anterior termina, mais o tempo de transição — inclusive na virada
 * de uma prova para a outra.
 *
 * Recalcular tudo, em vez de emendar a partir da última âncora, é o que torna
 * o resultado independente da ORDEM em que o organizador gerou as provas. A
 * agenda passa a ser função de (hora de início, transição, durações), e não do
 * histórico de cliques.
 *
 * FUSO HORÁRIO
 *
 * heats.scheduled_time é TIMESTAMP sem fuso de propósito: é horário de parede
 * ("a bateria começa às 10:12"), não um instante — ficou de fora da migration
 * 009 por isso. A conta aqui é feita em SEGUNDOS e somada no Postgres
 * (`data + hora_de_inicio + interval`), sem passar por Date do JavaScript. Um
 * `new Date('2026-09-22T08:00:00')` seria interpretado no fuso do processo
 * Node, e o mesmo código gravaria horários diferentes rodando no Windows do
 * organizador ou num container em UTC. Foi exatamente esse tipo de conversão
 * implícita que causou o bug do histórico de lançamentos.
 */

/**
 * Deslocamento, em segundos a partir do início do campeonato, de cada bateria.
 *
 * Pura e sem banco, para poder ser testada sozinha.
 *
 * Bateria sem duração conhecida (nenhuma categoria dela tem time cap) devolve
 * null — e, a partir dela, todas as seguintes também: sem saber quando aquela
 * termina, não há como afirmar quando a próxima começa. Chutar um horário
 * seria pior que não mostrar nenhum.
 */
const computeOffsets = (durations, transitionSeconds, extraAfter = []) => {
  let cursor = 0;
  let interrompido = false;

  return durations.map((duration, i) => {
    if (interrompido) return null;

    const offset = cursor;

    if (typeof duration === 'number' && Number.isFinite(duration)) {
      // extraAfter[i] é o intervalo configurado na prova, somado depois da
      // ÚLTIMA bateria dela (migration 013). Vem por bateria e não por prova
      // porque é aqui, percorrendo a lista achatada, que se sabe onde uma
      // prova termina e a outra começa.
      cursor += duration + transitionSeconds + (extraAfter[i] || 0);
    } else {
      interrompido = true;
    }

    return offset;
  });
};

/**
 * Reescreve scheduled_time de todas as baterias do campeonato.
 *
 * Recebe o `client` de uma transação em andamento: quem chama normalmente já
 * está no meio de uma (gerar baterias apaga e recria), e a agenda precisa ser
 * atomicamente consistente com as baterias que a originaram.
 */
const rescheduleChampionship = async (client, championshipId) => {
  const { rows: campeonatos } = await client.query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date_str,
            to_char(start_time, 'HH24:MI:SS') AS start_time_str,
            COALESCE(transition_seconds, 0) AS transition_seconds
       FROM championships
      WHERE id = $1`,
    [championshipId]
  );

  const campeonato = campeonatos[0];
  if (!campeonato) return;

  const limparTudo = () =>
    client.query(
      `UPDATE heats h SET scheduled_time = NULL
         FROM workouts w
        WHERE w.id = h.workout_id AND w.championship_id = $1
          AND h.scheduled_time IS NOT NULL`,
      [championshipId]
    );

  // Sem hora de início não existe agenda. As baterias continuam válidas — só
  // ficam sem horário, que é o comportamento que já existia.
  if (!campeonato.start_time_str) {
    await limparTudo();
    return;
  }

  const { rows: baterias } = await client.query(
    `SELECT h.id, h.duration_seconds, w.id AS workout_id, w.break_after_seconds
       FROM heats h
       JOIN workouts w ON w.id = h.workout_id
      WHERE w.championship_id = $1
      ORDER BY w.workout_number ASC, w.id ASC, h.heat_number ASC, h.id ASC`,
    [championshipId]
  );

  if (baterias.length === 0) return;

  // O intervalo da prova é somado uma vez só, depois da última bateria dela.
  // Como a lista está ordenada por prova, "última" é a bateria cuja seguinte
  // pertence a outra prova (ou que não tem seguinte).
  const intervalos = baterias.map((bateria, i) => {
    const proxima = baterias[i + 1];
    const ultimaDaProva = !proxima || proxima.workout_id !== bateria.workout_id;
    return ultimaDaProva && bateria.break_after_seconds
      ? Number(bateria.break_after_seconds)
      : 0;
  });

  const offsets = computeOffsets(
    baterias.map((b) => (b.duration_seconds === null ? null : Number(b.duration_seconds))),
    Number(campeonato.transition_seconds),
    intervalos
  );

  const comHorario = [];
  const semHorario = [];
  baterias.forEach((bateria, i) => {
    if (offsets[i] === null) semHorario.push(bateria.id);
    else comHorario.push({ id: bateria.id, offset: offsets[i] });
  });

  if (comHorario.length > 0) {
    // Um UPDATE só, com os deslocamentos numa lista de VALUES, em vez de uma
    // ida ao banco por bateria.
    const values = comHorario
      .map((_, i) => `($${i * 2 + 3}::int, $${i * 2 + 4}::int)`)
      .join(', ');
    const params = [campeonato.date_str, campeonato.start_time_str];
    comHorario.forEach(({ id, offset }) => params.push(id, offset));

    await client.query(
      `UPDATE heats h
          SET scheduled_time = ($1::date + $2::time) + (v.offset_seconds || ' seconds')::interval
         FROM (VALUES ${values}) AS v(id, offset_seconds)
        WHERE h.id = v.id`,
      params
    );
  }

  if (semHorario.length > 0) {
    await client.query('UPDATE heats SET scheduled_time = NULL WHERE id = ANY($1::int[])', [
      semHorario,
    ]);
  }
};

module.exports = { computeOffsets, rescheduleChampionship };
