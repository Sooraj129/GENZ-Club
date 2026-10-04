/**
 * Background session monitor — the server-side clock that drives every
 * session transition. It never trusts browser time.
 *
 * Each tick:
 *   1. SCHEDULED sessions whose start time has arrived  → ACTIVE (console PLAYING)
 *   2. ACTIVE sessions whose end time has passed          → EXPIRED, final bill,
 *      invoice generated, console freed
 *   3. Console statuses re-derived (e.g. AVAILABLE → RESERVED as a booking nears)
 *   4. Socket.IO events pushed to every connected client
 *
 * Idempotency: each transition runs in its own transaction that locks the
 * session row and re-checks its status before acting, invoices are unique per
 * session, and an in-process guard stops ticks overlapping. Running the monitor
 * twice — or on two server instances — can't double-complete or double-bill.
 *
 * Because all state lives in PostgreSQL, a tick after a server restart simply
 * catches up on anything that came due while the server was down.
 */
import { withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { consoleRepository } from '../repositories/consoleRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { sessionService } from '../services/sessionService.js';
import { settingsService } from '../services/settingsService.js';
import { emitEvent } from '../sockets/index.js';
import { logger } from '../utils/logger.js';
import { now } from '../utils/time.js';

export interface TickResult {
  started: number;
  expired: number;
  consolesUpdated: number;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export async function runSessionMonitorTick(): Promise<TickResult> {
  if (running) return { started: 0, expired: 0, consolesUpdated: 0 };
  running = true;
  const result: TickResult = { started: 0, expired: 0, consolesUpdated: 0 };
  try {
    const at = now();

    for (const id of await sessionRepository.dueToStart(at)) {
      try {
        if (await sessionService.activateDue(id)) result.started++;
      } catch (err) {
        logger.error({ err, sessionId: id }, 'Failed to start scheduled session');
      }
    }

    // Re-read "now": activating may have produced sessions that are also already over.
    for (const id of await sessionRepository.dueToExpire(now())) {
      try {
        if (await sessionService.expire(id)) result.expired++;
      } catch (err) {
        logger.error({ err, sessionId: id }, 'Failed to expire session');
      }
    }

    const changed = await withTransaction(async (client) => {
      const { reservation_window_minutes } = await settingsService.get(client);
      const ids = await consoleRepository.listIds(client);
      let count = 0;
      for (const id of ids) {
        if (await consoleRepository.syncStatus(id, now(), reservation_window_minutes, client)) count++;
      }
      return count;
    });
    result.consolesUpdated = changed;
    if (changed) {
      emitEvent('console:updated');
      emitEvent('dashboard:updated');
    }

    if (result.started || result.expired || result.consolesUpdated) {
      logger.info(result, 'Session monitor tick');
    }
    return result;
  } finally {
    running = false;
  }
}

export function startSessionMonitor(intervalMs = env.SESSION_MONITOR_INTERVAL_MS): void {
  if (timer) return;
  const tick = () =>
    runSessionMonitorTick().catch((err) => logger.error({ err }, 'Session monitor tick failed'));
  // Catch up immediately on boot (sessions that came due while the server was down).
  void tick();
  timer = setInterval(tick, intervalMs);
  logger.info({ intervalMs }, 'Session monitor started');
}

export function stopSessionMonitor(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
