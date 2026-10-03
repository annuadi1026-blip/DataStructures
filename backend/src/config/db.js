import pg from 'pg';
import { env } from './env.js';

// Return DATE columns as plain 'YYYY-MM-DD' strings (avoids timezone shifting).
pg.types.setTypeParser(1082, (v) => v);
// BIGINT (e.g. COUNT, BIGSERIAL) as numbers; our ids stay far below 2^53.
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

function sslOption() {
  if (env.DATABASE_SSL === 'true') return { rejectUnauthorized: false };
  if (env.DATABASE_SSL === 'false') return false;
  // Auto: Supabase and most hosted databases need TLS; localhost does not.
  const local = /@(localhost|127\.0\.0\.1|postgres|db)(:|\/)/.test(env.DATABASE_URL);
  return local ? false : { rejectUnauthorized: false };
}

let pool;
export function getPool() {
  if (!pool) {
    pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: sslOption(), max: 10, idleTimeoutMillis: 30000 });
    pool.on('error', (err) => console.error('Unexpected PG pool error', err.message));
  }
  return pool;
}

export const query = (text, params) => getPool().query(text, params);

export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) { await pool.end(); pool = undefined; }
}
