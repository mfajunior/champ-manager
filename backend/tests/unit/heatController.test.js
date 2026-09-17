const { distributeTeams } = require('../../src/controllers/heatController');

/**
 * distributeTeams é o round-robin que divide as equipes nas baterias.
 * Nenhuma dessas garantias (diferença máxima de 1 entre baterias, nenhuma
 * equipe perdida ou duplicada) é óbvia o bastante para dispensar teste —
 * é exatamente o tipo de função que alguém "otimiza" sem querer e quebra
 * silenciosamente.
 */
describe('distributeTeams (round-robin balanceado)', () => {
  test('6 equipes em 2 baterias vira 3 e 3, nunca 4 e 2', () => {
    const teams = [1, 2, 3, 4, 5, 6].map((id) => ({ id }));
    const buckets = distributeTeams(teams, 2);
    expect(buckets.map((b) => b.length)).toEqual([3, 3]);
  });

  test('5 equipes em 2 baterias: diferença máxima de 1 (3 e 2)', () => {
    const teams = [1, 2, 3, 4, 5].map((id) => ({ id }));
    const buckets = distributeTeams(teams, 2);
    const tamanhos = buckets.map((b) => b.length).sort();
    expect(tamanhos).toEqual([2, 3]);
  });

  test('nenhuma equipe é perdida nem duplicada, para qualquer proporção', () => {
    const teams = Array.from({ length: 11 }, (_, i) => ({ id: i + 1 }));
    const buckets = distributeTeams(teams, 4);
    const idsRecebidos = buckets
      .flat()
      .map((t) => t.id)
      .sort((a, b) => a - b);
    expect(idsRecebidos).toEqual(teams.map((t) => t.id));
  });

  test('1 equipe em 1 bateria', () => {
    const buckets = distributeTeams([{ id: 1 }], 1);
    expect(buckets).toEqual([[{ id: 1 }]]);
  });

  test('é round-robin (intercala), não "enche até o limite"', () => {
    // 4 equipes, 2 baterias: round-robin dá (A,C) e (B,D) — não (A,B) e (C,D),
    // que seria o resultado de simplesmente fatiar a lista em dois blocos.
    const teams = ['A', 'B', 'C', 'D'].map((name) => ({ name }));
    const buckets = distributeTeams(teams, 2);
    expect(buckets[0].map((t) => t.name)).toEqual(['A', 'C']);
    expect(buckets[1].map((t) => t.name)).toEqual(['B', 'D']);
  });
});
