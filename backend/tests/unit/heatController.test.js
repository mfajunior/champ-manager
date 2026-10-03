const { chunkIntoHeats } = require('../../src/controllers/heatController');
const { computeOffsets } = require('../../src/models/schedule');

/**
 * chunkIntoHeats recebe a lista já na ordem final de disputa (nível -> gênero,
 * achatada equipe-a-equipe pelo controller) e decide onde cortar. Nunca
 * reordena.
 *
 * DISTRIBUI em vez de fatiar. A versão anterior cortava de lanesPerHeat em
 * lanesPerHeat, o que num campeonato de 29 equipes com 4 raias produzia sete
 * baterias de 4 e uma de UMA — uma dupla sozinha no ginásio. O número de
 * baterias é o mesmo; o que muda é o espalhamento.
 */
describe('chunkIntoHeats (distribui em baterias, sem reordenar)', () => {
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

  // O caso que motivou a mudança: o campeonato real tem 29 equipes e o box
  // tem 4 raias. Fatiando dava 4,4,4,4,4,4,4,1.
  test('29 equipes em 4 raias não deixam ninguém sozinho', () => {
    const assignments = Array.from({ length: 29 }, (_, i) => ({ id: i + 1 }));
    const chunks = chunkIntoHeats(assignments, 4);

    expect(chunks.map((c) => c.length)).toEqual([4, 4, 4, 4, 4, 3, 3, 3]);
    expect(chunks).toHaveLength(Math.ceil(29 / 4));
  });

  // A regra que o projeto documentava desde o início e que se perdeu quando o
  // distributeTeams foi substituído: equilibrar, não encher até o limite.
  test('6 equipes em 4 raias viram 3+3, não 4+2', () => {
    const assignments = Array.from({ length: 6 }, (_, i) => ({ id: i + 1 }));
    expect(chunkIntoHeats(assignments, 4).map((c) => c.length)).toEqual([3, 3]);
  });

  test('nunca estoura as raias, nem deixa bateria vazia, em nenhuma proporção', () => {
    for (let total = 1; total <= 80; total += 1) {
      for (let raias = 2; raias <= 10; raias += 1) {
        const assignments = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
        const chunks = chunkIntoHeats(assignments, raias);
        const tamanhos = chunks.map((c) => c.length);

        expect(chunks).toHaveLength(Math.ceil(total / raias));
        expect(Math.max(...tamanhos)).toBeLessThanOrEqual(raias);
        expect(Math.min(...tamanhos)).toBeGreaterThan(0);
        // Equilíbrio: a maior e a menor bateria diferem em no máximo uma equipe.
        expect(Math.max(...tamanhos) - Math.min(...tamanhos)).toBeLessThanOrEqual(1);
        // Nenhuma equipe perdida, duplicada ou fora de ordem.
        expect(chunks.flat().map((a) => a.id)).toEqual(assignments.map((a) => a.id));
      }
    }
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
