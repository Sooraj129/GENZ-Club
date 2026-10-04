/**
 * Serverless replacement for the 15-second background timer.
 *
 * On Vercel there's no process that keeps running between requests, so the
 * session monitor (start due sessions, expire finished ones, invoice, free
 * consoles) runs *before handling a request* instead — at most once every
 * 10 seconds per function instance. Staff screens refresh every ~10 s, so while
 * anyone has the app open, sessions are settled promptly.
 *
 * Correctness doesn't depend on timing: an expired session is always billed to
 * its booked end time, and the monitor is idempotent (safe to run on several
 * instances at once). A daily Vercel Cron call (/api/cron/session-monitor)
 * tidies up anything that came due while nobody had the app open.
 */
import type { NextFunction, Request, Response } from 'express';
import { runSessionMonitorTick } from '../jobs/sessionMonitor.js';
import { logger } from '../utils/logger.js';

const MIN_INTERVAL_MS = 10_000;
let lastRun = 0;

export async function lazySessionMonitor(req: Request, _res: Response, next: NextFunction) {
  const now = Date.now();
  if (now - lastRun >= MIN_INTERVAL_MS) {
    lastRun = now;
    try {
      const result = await runSessionMonitorTick();
      if (result.started || result.expired) logger.info({ rid: req.requestId, ...result }, 'Session monitor (on request)');
    } catch (err) {
      // Never block the actual request because of the monitor.
      logger.error({ err, rid: req.requestId }, 'Session monitor (on request) failed');
    }
  }
  next();
}
