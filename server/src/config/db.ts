import pg from 'pg';
import { env, BUSINESS_TIMEZONE } from './env.js';
import { logger } from '../utils/logger.js';

// NUMERIC columns come back as strings by default; amounts in this app are
// bounded (NUMERIC(10,2)) so parsing to number is safe. COUNT(*) is int8.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));
// DATE columns stay as 'YYYY-MM-DD' strings rather than being shifted into a JS Date.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// Timestamps are stored as TIMESTAMPTZ (absolute instants). Business-day
// bucketing never relies on the connection's TimeZone setting (which a
// transaction pooler can't guarantee); queries use `AT TIME ZONE` explicitly.
export const SQL_TZ = `'${BUSINESS_TIMEZONE}'`;

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected idle database client error');
});

/** Anything that can run a query: the pool or a checked-out transaction client. */
export type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
  db: Queryable = pool,
): Promise<pg.QueryResult<T>> {
  return db.query<T>(text, params);
}

/**
 * Runs `fn` inside a single transaction on one connection. Commits on success,
 * rolls back on any thrown error. Callers must only use the provided client
 * inside `fn` (never the pool) so the work stays atomic.
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
