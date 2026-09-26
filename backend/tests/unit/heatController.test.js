const { chunkIntoHeats } = require('../../src/controllers/heatController');
const { computeOffsets } = require('../../src/models/schedule');

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
 * computeOffsets substituiu computeHeatSchedule.
 *
 * A função antiga recebia um Date e devolvia Dates. Isso a tornava refém do
 * fuso do processo Node: o mesmo código gravava horários diferentes rodando no
 * Windows do organizador (UTC-3) ou num container em UTC — a mesma classe de
 * bug que a migration 009 corrigiu no histórico de lançamentos.
 *
 * Agora a conta é em SEGUNDOS e a soma acontece no Postgres
 * (`data + hora_de_inicio + interval`), sem conversão implícita de fuso em
 * lugar nenhum. Os casos testados são os mesmos; muda a unidade.
 *
 * Bateria de duração desconhecida ainda recebe o próprio horário de início, e
 * "quebra" a cadeia: sem saber quando ela termina, não dá para afirmar quando
 * a próxima começa.
 */
describe('computeOffsets (encadeia em segundos, propaga null)', () => {
  test('encadeia duração + transição entre baterias consecutivas', () => {
    // 600s + 60s de transição = a segunda começa 660s depois da primeira.
    expect(computeOffsets([600, 300, 900], 60)).toEqual([0, 660, 1020]);
  });

  test('duração desconhecida recebe horário, mas quebra a cadeia', () => {
    expect(computeOffsets([600, null, 300], 60)).toEqual([0, 660, null]);
  });

  test('transição zero é válida (baterias emendadas)', () => {
    expect(computeOffsets([600, 600], 0)).toEqual([0, 600]);
  });

  test('a primeira bateria começa sempre no instante zero do campeonato', () => {
    expect(computeOffsets([600], 60)[0]).toBe(0);
  });

  test('lista vazia devolve lista vazia', () => {
    expect(computeOffsets([], 60)).toEqual([]);
  });

  // O intervalo (migration 013) entra como folga extra DEPOIS de uma bateria
  // específica — a última da prova. Vem por bateria e não por prova porque é
  // percorrendo a lista achatada que se sabe onde uma prova termina.
  test('intervalo depois de uma bateria empurra todas as seguintes', () => {
    // 2 baterias de 600s, transição 60s, e 1800s de intervalo depois da 1ª.
    expect(computeOffsets([600, 600], 60, [1800, 0])).toEqual([0, 2460]);
  });

  test('sem intervalo, o resultado é idêntico ao de antes', () => {
    expect(computeOffsets([600, 600], 60, [0, 0])).toEqual(computeOffsets([600, 600], 60));
  });

  test('intervalo depois de bateria sem duração não ressuscita a cadeia', () => {
    expect(computeOffsets([600, null, 300], 60, [0, 1800, 0])).toEqual([0, 660, null]);
  });
});
