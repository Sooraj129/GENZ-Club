import { withTransaction } from '../config/db.js';
import { consoleRepository } from '../repositories/consoleRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { emitEvent } from '../sockets/index.js';
import type { ConsoleType } from '../types/index.js';
import { badRequest, conflict, isPgError, notFound, PG } from '../utils/errors.js';
import { now } from '../utils/time.js';
import { settingsService } from './settingsService.js';

/** What an admin can set: an operational console, or one taken out of service. */
export type ConsoleAdminStatus = 'AVAILABLE' | 'MAINTENANCE' | 'DISABLED';

export const consoleService = {
  list() {
    return consoleRepository.list();
  },

  async get(id: string) {
    const console = await consoleRepository.findById(id);
    if (!console) throw notFound('Console not found');
    return console;
  },

  /** Live bookings on a console for a window — powers the availability preview on New Session. */
  async schedule(id: string, from: Date, to: Date) {
    await this.get(id);
    return sessionRepository.listLiveForConsole(id, from, to);
  },

  async create(input: {
    console_number: string;
    console_type: ConsoleType;
    hourly_rate: number | null;
    status: ConsoleAdminStatus;
  }) {
    try {
      const id = await consoleRepository.create(input);
      emitEvent('console:updated', { console_id: id });
      emitEvent('dashboard:updated');
      return this.get(id);
    } catch (err) {
      if (isPgError(err, PG.UNIQUE_VIOLATION)) throw conflict(`Console ${input.console_number} already exists`);
      throw err;
    }
  },

  /**
   * Permanently removes a console. Only allowed when it has never been booked —
   * a console with history is referenced by sessions/invoices and should be set
   * to DISABLED instead, so past invoices stay intact.
   */
  async remove(id: string) {
    const console = await this.get(id);
    if (await consoleRepository.hasSessions(id)) {
      throw badRequest(`${console.console_number} has session history and cannot be deleted. Set its status to Disabled instead.`);
    }
    await consoleRepository.remove(id);
    emitEvent('console:updated', { console_id: id });
    emitEvent('dashboard:updated');
  },

  async update(
    id: string,
    input: Partial<{ console_number: string; console_type: ConsoleType; hourly_rate: number | null; status: ConsoleAdminStatus }>,
  ) {
    try {
      await withTransaction(async (client) => {
        const current = await consoleRepository.lockById(id, client);
        if (!current) throw notFound('Console not found');

        if (input.status === 'MAINTENANCE' || input.status === 'DISABLED') {
          if (await sessionRepository.hasActive(id, client)) {
            throw badRequest(`${current.console_number} has an active session. End it before changing the status.`);
          }
        }
        // AVAILABLE means "back in service" — the real state is derived from bookings below.
        await consoleRepository.update(id, input, client);
        if (input.status === 'AVAILABLE') {
          const { reservation_window_minutes } = await settingsService.get(client);
          await consoleRepository.syncStatus(id, now(), reservation_window_minutes, client);
        }
      });
    } catch (err) {
      if (isPgError(err, PG.UNIQUE_VIOLATION)) throw conflict(`Console ${input.console_number} already exists`);
      throw err;
    }
    emitEvent('console:updated', { console_id: id });
    emitEvent('dashboard:updated');
    return this.get(id);
  },
};
