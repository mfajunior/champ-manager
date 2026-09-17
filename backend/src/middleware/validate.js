// src/middleware/validate.js

/**
 * Middleware genérico de validação com Joi.
 *
 * Antes disso, cada controller validava campo por campo com
 * `if (!x) return res.status(400)...` — funciona, mas cada validação nova
 * significa duplicar o mesmo bloco em outro arquivo, e nada garante que o
 * TIPO do campo está certo (ex.: workout_number vindo como "abc" só quebraria
 * lá na frente, na query SQL, com um erro de banco confuso).
 *
 * Joi estava no package.json desde o commit inicial do projeto — uma
 * dependência "pronta pra usar" que nunca chegou a ser chamada em lugar
 * nenhum. Em vez de continuar carregando peso morto ou tirar a dependência,
 * passou a validar de verdade: um schema por rota de escrita, checado uma vez
 * aqui, antes do controller.
 *
 * O que Joi NÃO faz aqui: checar se um ID existe no banco, ou se duas
 * entidades são compatíveis entre si (ex.: "esta categoria pertence a este
 * campeonato?"). Isso continua nos controllers, porque exige consultar o
 * banco — validação de forma e validação de regra de negócio são coisas
 * diferentes, e só a primeira faz sentido aqui.
 */
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false, // junta todos os erros de uma vez, não só o primeiro
    stripUnknown: true, // ignora campos que o cliente mandou a mais
  });

  if (error) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: error.details.map((d) => d.message).join('; '),
      },
    });
  }

  req.body = value;
  next();
};

module.exports = { validate };
