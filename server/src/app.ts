import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pool } from './config/db.js';
import { env } from './config/env.js';
import { startSessionMonitor, stopSessionMonitor } from './jobs/sessionMonitor.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { router } from './routes/index.js';
import { closeSockets, initSockets } from './sockets/index.js';
import { logger } from './utils/logger.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // The web app runs on its own origin (e.g. :5173) and calls this API (:5000) directly.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: env.clientOrigins,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['Content-Disposition', 'X-Request-Id'],
    }),
  );
  app.use(requestLogger);
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

async function main() {
  const app = createApp();
  const server = createServer(app);
  initSockets(server);

  await pool.query('SELECT 1'); // fail fast if the database is unreachable
  server.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));
  startSessionMonitor();

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    stopSessionMonitor();
    await closeSockets();
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((err) => {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  });
}
