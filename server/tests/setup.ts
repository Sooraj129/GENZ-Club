/**
 * Each test file gets its own throwaway PostgreSQL (PGlite — real Postgres
 * compiled to WASM) exposed over the wire protocol, so the production `pg`
 * driver, SQL, constraints and transactions are exercised exactly as on Supabase.
 */
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll } from 'vitest';

const db = await PGlite.create({ extensions: { btree_gist } });
const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });
await server.start();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = `postgresql://postgres:postgres@${server.getServerConn()}/postgres`;
process.env.DATABASE_SSL = 'false';
// PGlite is single-connection: one pooled client also proves no code path
// grabs a second connection while holding a transaction.
process.env.DB_POOL_MAX = '1';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';

const { migrate } = await import('../scripts/migrate.js');
await migrate(() => undefined);

afterAll(async () => {
  const { pool } = await import('../src/config/db.js');
  await pool.end();
  await server.stop();
  await db.close();
});
