const { chunkIntoHeats, computeHeatSchedule } = require('../../src/controllers/heatController');

/**
 * chunkIntoHeats substitui o antigo distributeTeams (round-robin balanceado
 * DENTRO de uma categoria). Com baterias mistas isso deixou de fazer sentido:
 * a lista já chega pronta, na ordem final de disputa (nível -> gênero,
 * achatada equipe-a-equipe pelo controller), e a única responsabilidade
 * daqui é fatiar em blocos de até `lanesPerHeat` — sem reordenar nada.
 */
describe('chunkIntoHeats (fatia em baterias, sem reordenar)', () => {
  test('divide em blocos completos quando o total é múltiplo das raias', () => {
    const assignments = [1, 2, 3, 4, 5, 6].map((id) => ({ id }));
    const chunks = chunkIntoHeats(assignments, 3);
    expect(chunks.map((c) => c.map((a) => a.id))).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  test('a última bateria sobra incompleta quando o total não é múltiplo', () => {
    const assignments = [1, 2, 3, 4, 5].map((id) => ({ id }));
    const chunks = chunkIntoHeats(assignments, 3);
    expect(chunks.map((c) => c.map((a) => a.id))).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });

  test('preserva a ordem de entrada (não reordena, não intercala)', () => {
    const assignments = ['A', 'B', 'C', 'D'].map((name) => ({ name }));
    const chunks = chunkIntoHeats(assignments, 2);
    expect(chunks[0].map((a) => a.name)).toEqual(['A', 'B']);
    expect(chunks[1].map((a) => a.name)).toEqual(['C', 'D']);
  });

  test('nenhuma equipe é perdida nem duplicada, para qualquer proporção', () => {
    const assignments = Array.from({ length: 11 }, (_, i) => ({ id: i + 1 }));
    const chunks = chunkIntoHeats(assignments, 4);
    const idsRecebidos = chunks.flat().map((a) => a.id);
    expect(idsRecebidos).toEqual(assignments.map((a) => a.id));
  });

  test('lista vazia não gera bateria nenhuma', () => {
    expect(chunkIntoHeats([], 4)).toEqual([]);
  });

  test('1 equipe em 1 bateria', () => {
    expect(chunkIntoHeats([{ id: 1 }], 4)).toEqual([[{ id: 1 }]]);
  });
});

/**
 * computeHeatSchedule encadeia o horário de cada bateria a partir de um
 * cursor inicial, somando duração + transição a cada passo. Uma vez que uma
 * bateria de duração desconhecida aparece, o cursor "quebra" (vira null) e
 * todas as baterias seguintes também ficam sem horário -- não dá pra saber
 * quando uma bateria começa sem saber quando a anterior termina.
 */
describe('computeHeatSchedule (encadeia horário, propaga null)', () => {
  test('sem cursor inicial, nenhuma bateria recebe horário', () => {
    const heatPlans = [{ durationSeconds: 600 }, { durationSeconds: 600 }];
    const schedule = computeHeatSchedule(heatPlans, { startCursor: null, transitionSeconds: 60 });
    expect(schedule).toEqual([{ scheduledTime: null }, { scheduledTime: null }]);
  });

  test('encadeia duração + transição entre baterias consecutivas', () => {
    const start = new Date('2026-10-10T08:00:00.000Z');
    const heatPlans = [{ durationSeconds: 600 }, { durationSeconds: 300 }, { durationSeconds: 900 }];
    const schedule = computeHeatSchedule(heatPlans, { startCursor: start, transitionSeconds: 60 });

    expect(schedule[0].scheduledTime).toEqual(new Date('2026-10-10T08:00:00.000Z'));
    // 08:00 + 600s (10min) + 60s transição = 08:11:00
    expect(schedule[1].scheduledTime).toEqual(new Date('2026-10-10T08:11:00.000Z'));
    // 08:11 + 300s (5min) + 60s transição = 08:17:00
    expect(schedule[2].scheduledTime).toEqual(new Date('2026-10-10T08:17:00.000Z'));
  });

  test('duração desconhecida (null) "quebra" o cursor: a própria bateria ainda recebe horário, as seguintes não', () => {
    const start = new Date('2026-10-10T08:00:00.000Z');
    const heatPlans = [{ durationSeconds: 600 }, { durationSeconds: null }, { durationSeconds: 300 }];
    const schedule = computeHeatSchedule(heatPlans, { startCursor: start, transitionSeconds: 60 });

    expect(schedule[0].scheduledTime).toEqual(new Date('2026-10-10T08:00:00.000Z'));
    // 08:00 + 600s (10min) + 60s transição = 08:11:00 -- a própria bateria de
    // duração desconhecida ainda recebe esse horário de início.
    expect(schedule[1].scheduledTime).toEqual(new Date('2026-10-10T08:11:00.000Z'));
    expect(schedule[2].scheduledTime).toBeNull(); // dali pra frente, ninguém mais recebe horário
  });

  test('transitionSeconds = 0 é válido (sem intervalo entre baterias)', () => {
    const start = new Date('2026-10-10T08:00:00.000Z');
    const heatPlans = [{ durationSeconds: 600 }, { durationSeconds: 600 }];
    const schedule = computeHeatSchedule(heatPlans, { startCursor: start, transitionSeconds: 0 });
    expect(schedule[1].scheduledTime).toEqual(new Date('2026-10-10T08:10:00.000Z'));
  });

  test('lista vazia devolve lista vazia', () => {
    expect(computeHeatSchedule([], { startCursor: new Date(), transitionSeconds: 60 })).toEqual([]);
  });
});
