const { ALLOWED_SCORING_TYPES } = require('../../src/controllers/workoutController');

/**
 * Esta lista é o que impede o bug que já aconteceu de verdade neste projeto:
 * toda prova nova nascia com scoring_type='time' (default do banco) porque o
 * create nem aceitava o campo. Não testa muito em termos de lógica, mas
 * fixa o contrato — se alguém adicionar um quarto scoring_type sem atualizar
 * o CHECK constraint da migration 003, esse teste não vai avisar sozinho,
 * mas pelo menos documenta a lista esperada num lugar que quebra visivelmente
 * se for editado sem cuidado.
 */
describe('ALLOWED_SCORING_TYPES', () => {
  test('contém exatamente time, reps e load', () => {
    expect([...ALLOWED_SCORING_TYPES].sort()).toEqual(['load', 'reps', 'time']);
  });

  test.each(['time', 'reps', 'load'])('"%s" é aceito', (tipo) => {
    expect(ALLOWED_SCORING_TYPES.includes(tipo)).toBe(true);
  });

  test('"pontos" não é aceito (não existe esse scoring_type)', () => {
    expect(ALLOWED_SCORING_TYPES.includes('pontos')).toBe(false);
  });
});
