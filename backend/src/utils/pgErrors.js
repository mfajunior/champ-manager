/**
 * Traduz erro do Postgres para resposta HTTP.
 *
 * POR QUE PRECISA EXISTIR
 * O error handler central (app.js) usa `err.code` como código da resposta e
 * `err.status || 500` como status. Num erro do driver pg, `err.code` é o
 * SQLSTATE: sem tradução, uma faixa de pontuação com buraco devolveria
 * `500 { code: "P0001" }` com a mensagem crua da função PL/pgSQL. Status
 * errado (é erro do cliente, não do servidor) e código que não diz nada a
 * quem consome a API.
 *
 * Vale para qualquer controller que dependa de constraint no banco: tratar o
 * erro não é opcional, é parte de manter a regra no Postgres. Ficou em
 * utils/ porque três controllers precisam (tabelas de pontos, cortes e troca
 * de modelo) e importar de dentro de um controller para outro seria
 * acoplamento gratuito.
 *
 * As mensagens das constraint triggers (migration 012) são escritas em
 * português e voltadas ao usuário justamente para serem repassadas direto,
 * sem uma segunda tabela de mensagens para manter em sincronia.
 */
const respondToPgError = (err, res, next) => {
  // RAISE EXCEPTION das funções PL/pgSQL (validação das faixas de pontuação).
  if (err.code === 'P0001') {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: err.message },
    });
  }

  // CHECK constraint.
  if (err.code === '23514') {
    const constraint = String(err.constraint || '');
    const message = constraint.includes('points_table_required')
      ? 'Para usar a pontuação estilo CrossFit Games é preciso escolher uma tabela de pontos.'
      : constraint.includes('scoring_model')
        ? 'Modelo de pontuação inválido.'
        : 'Valor inválido: confira as colocações e o decremento.';
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message } });
  }

  // UNIQUE.
  if (err.code === '23505') {
    const constraint = String(err.constraint || '');
    const message = constraint.includes('open_range')
      ? 'Só pode existir uma faixa aberta ("em diante") por tabela.'
      : constraint.includes('start_place')
        ? 'Duas faixas começam na mesma colocação.'
        : constraint.includes('workout_cuts')
          ? 'Já existe um corte configurado para esta prova.'
          : 'Já existe um registro com esses dados.';
    return res.status(409).json({ error: { code: 'CONFLICT', message } });
  }

  // FOREIGN KEY — inclui o ON DELETE RESTRICT de championships.points_table_id.
  if (err.code === '23503') {
    const message = String(err.constraint || '').includes('points_table')
      ? 'Esta tabela de pontos está em uso por um campeonato. Troque a tabela do campeonato antes de excluí-la.'
      : 'Registro relacionado não encontrado ou ainda em uso.';
    return res.status(409).json({ error: { code: 'CONFLICT', message } });
  }

  return next(err);
};

module.exports = { respondToPgError };
