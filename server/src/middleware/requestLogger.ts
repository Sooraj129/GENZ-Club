/**
 * Request logging — one line per API call, so any problem can be traced.
 *
 *   → POST /api/sessions                 (debug: request received)
 *   ← POST /api/sessions 201 42ms        (info: response sent)
 *
 * Every request gets a request ID:
 *   - taken from the client's `X-Request-Id` header if present (the web app sends one),
 *   - otherwise generated here.
 * The ID is returned in the `X-Request-Id` response header and included in
 * error responses as `requestId`. To debug a failed call, copy the ID from the
 * browser console / error toast and search the server log for it.
 */
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

const VALID_ID = /^[A-Za-z0-9-]{8,64}$/;

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);

  const startedAt = process.hrtime.bigint();
  logger.debug({ rid: req.requestId }, `→ ${req.method} ${req.originalUrl}`);

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const line = `← ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms`;
    const context = { rid: req.requestId, user: req.user?.email };
    // 5xx = our bug (error), 4xx = rejected request (warn), rest = normal traffic.
    if (res.statusCode >= 500) logger.error(context, line);
    else if (res.statusCode >= 400) logger.warn(context, line);
    else logger.info(context, line);
  });

  next();
}
