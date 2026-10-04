/**
 * Central error handling. Every failure becomes:
 *
 *   { success: false, message: "...", requestId: "..." }
 *
 * How errors are classified (first match wins):
 *   1. AppError      — thrown on purpose by services (e.g. "PS5-01 is already booked"). Message is safe to show.
 *   2. ZodError      — request failed validation → 400 with the first problem.
 *   3. Bad JSON body — 400.
 *   4. PostgreSQL    — known constraint errors become friendly 4xx messages.
 *   5. Anything else — a bug. Logged in full (stack, SQL error) on the server;
 *                      the client only gets a generic message + requestId.
 *
 * To debug: take the requestId from the browser and search the server log.
 */
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, isPgError, PG } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

function sendError(req: Request, res: Response, status: number, message: string, extra: Record<string, unknown> = {}) {
  res.status(status).json({ success: false, message, ...extra, requestId: req.requestId });
}

export function notFoundHandler(req: Request, res: Response) {
  sendError(req, res, 404, `Route not found: ${req.method} ${req.path}`);
}

/** Friendly messages for database constraint errors that can reach the client. */
const PG_ERRORS: Record<string, [number, string]> = {
  [PG.EXCLUSION_VIOLATION]: [409, 'Console is already booked for the selected time.'],
  [PG.UNIQUE_VIOLATION]: [409, 'A record with these details already exists.'],
  [PG.FOREIGN_KEY_VIOLATION]: [400, 'A referenced record does not exist or is still in use.'],
  [PG.CHECK_VIOLATION]: [400, 'The submitted values are not allowed.'],
  [PG.SERIALIZATION_FAILURE]: [409, 'The record was changed by someone else. Please try again.'],
  [PG.DEADLOCK_DETECTED]: [409, 'The record was changed by someone else. Please try again.'],
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const rid = req.requestId;

  // 1. Expected business-rule errors.
  if (err instanceof AppError) {
    logger.warn({ rid, status: err.statusCode }, `Rejected: ${err.message}`);
    return sendError(req, res, err.statusCode, err.message, err.data !== undefined ? { data: err.data } : {});
  }

  // 2. Validation errors.
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const field = issue?.path.join('.');
    const message = issue ? (field ? `${field}: ${issue.message}` : issue.message) : 'Invalid request';
    logger.warn({ rid, issues: err.issues }, `Validation failed: ${message}`);
    return sendError(req, res, 400, message, {
      errors: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  // 3. Malformed JSON body.
  if (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.parse.failed') {
    return sendError(req, res, 400, 'Request body is not valid JSON');
  }

  // 4. Known database constraint errors.
  if (isPgError(err) && PG_ERRORS[err.code]) {
    const [status, message] = PG_ERRORS[err.code];
    logger.warn({ rid, pgCode: err.code, constraint: err.constraint }, `Database rejected request: ${message}`);
    return sendError(req, res, status, message);
  }

  // 5. Unexpected — this is a bug. Full details stay in the server log only.
  logger.error({ rid, err, method: req.method, path: req.originalUrl }, 'Unhandled error');
  sendError(req, res, 500, 'Something went wrong. Please try again.');
}
