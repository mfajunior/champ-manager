// src/config/database.js
const pg = require('pg');
require('dotenv').config();

const { Pool } = pg;

/**
 * DB_SSL=true liga TLS na conexão com o Postgres. Precisa estar ligado para
 * bancos hospedados (Neon, Render Postgres, etc.) — eles recusam conexão sem
 * criptografia. Fica desligado por padrão porque o Postgres local (Docker)
 * não expõe certificado nenhum: ligar TLS ali só quebraria a conexão em dev.
 *
 * rejectUnauthorized fica true (o padrão): a Neon usa certificado de uma CA
 * pública, então dá pra validar a cadeia normalmente — testei local com
 * rejectUnauthorized: true contra um Postgres de certificado autoassinado e
 * a conexão é corretamente recusada ("self-signed certificate"), confirmando
 * que a verificação está de fato ativa, não é só um parâmetro decorativo.
 * Desligar essa verificação (rejectUnauthorized: false, comum em tutorial
 * antigo de Heroku Postgres) abriria a conexão a um ataque
 * man-in-the-middle sem necessidade nenhuma aqui.
 */
const useSSL = process.env.DB_SSL === 'true';

/**
 * Pool de conexões PostgreSQL
 * Reutiliza conexões para melhor performance
 */
/**
 * DUAS FORMAS DE DIZER ONDE O BANCO ESTÁ
 *
 * As cinco variáveis DB_* continuam sendo o caminho de desenvolvimento e de
 * teste: é o que o docker-compose levanta e o que o .env.test aponta.
 *
 * DATABASE_URL existe para hospedagem. Render, Neon e praticamente todo
 * Postgres gerenciado entregam UMA string de conexão, não cinco campos —
 * e, quando o banco é recriado, entregam uma string nova. Aceitar o formato
 * deles significa que o provedor religa o backend sozinho, em vez de alguém
 * copiar cinco valores à mão e errar um.
 *
 * Quando as duas existem, DATABASE_URL vence: ela só é definida onde alguém
 * a definiu de propósito, enquanto as DB_* têm padrões que apontariam
 * silenciosamente para o localhost errado.
 */
const conexao = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'champy_championship',
    };

const pool = new Pool({
  ...conexao,
  // 20 e o teto do processo de producao, que e UM. Sob jest, cada arquivo de
  // teste roda no seu proprio processo e abriria o seu proprio pool de 20 —
  // com 7 workers isso passa das 100 conexoes padrao do Postgres e a suite
  // quebra com "too many clients already". Cada teste faz query sequencial,
  // entao 5 por processo sobra.
  max: process.env.NODE_ENV === 'test' ? 5 : 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  // Vale para os dois formatos: mesmo com sslmode na string de conexão, a
  // opção explícita é a que o node-postgres usa. Por isso DB_SSL=true
  // continua obrigatório em banco hospedado.
  ssl: useSSL ? { rejectUnauthorized: true } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

/**
 * Query helper com logging
 */
const query = async (text, params = []) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.LOG_LEVEL === 'debug') {
      console.log('Query executed', { text, duration, rows: result.rowCount });
    }
    return result;
  } catch (error) {
    // NEM TODO ERRO DE SQL É FALHA
    //
    // SQLSTATE da classe 23 é violação de constraint de integridade, e P0001 é
    // RAISE EXCEPTION das nossas próprias funções PL/pgSQL. Os dois são
    // RESULTADOS ESPERADOS: os controllers os traduzem em 400/409 e o cliente
    // recebe uma mensagem legível em português.
    //
    // Registrar isso como "Database error" com stack completo faz um erro de
    // uso comum — tentar excluir uma tabela de pontos que está em uso, salvar
    // faixas com buraco — parecer falha de infraestrutura. No meio de um
    // evento é exatamente esse ruído que esconde o problema de verdade: quem
    // abre o log procurando a causa de uma queda encontra dez stacks de
    // constraints que funcionaram como deveriam.
    //
    // Continua sendo registrado, em uma linha, com constraint e tabela — o
    // suficiente para investigar sem afogar o log.
    const violacaoEsperada =
      error.code === 'P0001' || String(error.code || '').startsWith('23');

    // Na suíte, essa violação esperada vira ruído: vários testes exercitam
    // DE PROPÓSITO o caminho em que o banco recusa (excluir tabela de pontos
    // em uso, faixa de pontuação com buraco), e cada um imprime um aviso que
    // não diz nada sobre o resultado da execução. É o mesmo motivo que já faz
    // o tests/env.setup.js silenciar o log de query: o "163 passed" não pode
    // ficar enterrado sob saída que ninguém vai ler.
    //
    // Só em teste, e só quando LOG_LEVEL não é debug — a mesma alavanca do log
    // de query, então LOG_LEVEL=debug npm test continua mostrando tudo ao
    // depurar uma execução específica. Em produção nada muda: o aviso existe
    // justamente para o log do dia do evento.
    const silenciarNaSuite =
      process.env.NODE_ENV === 'test' && process.env.LOG_LEVEL !== 'debug';

    if (violacaoEsperada) {
      if (!silenciarNaSuite) {
        console.warn(JSON.stringify({
          level: 'warn',
          message: 'Constraint recusou a operação',
          code: error.code,
          constraint: error.constraint,
          table: error.table,
          detail: error.message,
          timestamp: new Date().toISOString(),
        }));
      }
    } else {
      console.error('Database error:', error);
    }

    throw error;
  }
};

/**
 * Helper para obter uma única linha
 */
const queryOne = async (text, params = []) => {
  const result = await query(text, params);
  return result.rows[0] || null;
};

/**
 * Helper para obter múltiplas linhas
 */
const queryAll = async (text, params = []) => {
  const result = await query(text, params);
  return result.rows;
};

module.exports = {
  pool,
  query,
  queryOne,
  queryAll,
};
