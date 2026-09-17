const { validateScoreShape } = require('../../src/controllers/resultController');

/**
 * validateScoreShape não toca em banco — é só a regra da constraint
 * results_value_or_dnf (migration 003) checada em JS antes da query, para
 * devolver uma mensagem legível em vez do erro cru do Postgres. Por não
 * precisar de banco, é o candidato ideal para o primeiro teste unitário
 * do projeto: roda em milissegundos, sem Docker, sem rede.
 */
describe('validateScoreShape', () => {
  test('aceita raw_value sozinho', () => {
    expect(validateScoreShape(500, undefined)).toBeNull();
  });

  test('aceita did_not_finish sozinho', () => {
    expect(validateScoreShape(undefined, true)).toBeNull();
  });

  test('aceita raw_value = 0 (0 é um valor legítimo, não "ausente")', () => {
    // Esse é o caso que quebra implementações ingênuas: "!rawValue" trataria
    // 0 reps como se nada tivesse sido informado. A implementação real
    // compara com undefined/null/string vazia, não com truthy/falsy.
    expect(validateScoreShape(0, undefined)).toBeNull();
  });

  test('aceita did_not_finish = false explícito, com valor', () => {
    expect(validateScoreShape(120, false)).toBeNull();
  });

  test('rejeita raw_value e did_not_finish informados juntos', () => {
    const erro = validateScoreShape(500, true);
    expect(erro).not.toBeNull();
    expect(erro).toMatch(/ao mesmo tempo/);
  });

  test('rejeita quando nenhum dos dois é informado', () => {
    const erro = validateScoreShape(undefined, undefined);
    expect(erro).not.toBeNull();
    expect(erro).toMatch(/Informe raw_value/);
  });

  test('rejeita raw_value vazio ("") sem did_not_finish', () => {
    const erro = validateScoreShape('', false);
    expect(erro).not.toBeNull();
  });

  test('rejeita raw_value null sem did_not_finish', () => {
    const erro = validateScoreShape(null, false);
    expect(erro).not.toBeNull();
  });
});
