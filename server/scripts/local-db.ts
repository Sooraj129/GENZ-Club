/**
 * Optional: a local PostgreSQL (PGlite) for development without Supabase.
 * Data persists in server/.pglite. Point DATABASE_URL at it:
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres
 *   DATABASE_SSL=false
 *   DB_POOL_MAX=1        # PGlite is single-connection
 */
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const port = Number(process.env.LOCAL_DB_PORT ?? 54329);
const db = await PGlite.create('./.pglite', { extensions: { btree_gist } });
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
await server.start();
console.log(`Local PostgreSQL (PGlite) listening on postgresql://postgres:postgres@127.0.0.1:${port}/postgres`);

const shutdown = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
