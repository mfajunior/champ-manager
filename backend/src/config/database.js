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
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'champy_championship',
  max: 20, // máximo de conexões simultâneas
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
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
    console.error('Database error:', error);
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
