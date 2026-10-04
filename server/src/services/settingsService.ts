import { withTransaction, type Queryable } from '../config/db.js';
import { pricingRepository, settingsRepository } from '../repositories/settingsRepository.js';
import type { ConsoleType } from '../types/index.js';
import { notFound } from '../utils/errors.js';
import { emitEvent } from '../sockets/index.js';

export interface BusinessSettings {
  business_name: string;
  business_address: string;
  business_phone: string;
  tax_percent: number;
  reservation_window_minutes: number;
}

export const settingsService = {
  async get(db?: Queryable): Promise<BusinessSettings> {
    const s = await settingsRepository.getAll(db);
    return {
      business_name: s.business_name ?? 'Game Center',
      business_address: s.business_address ?? '',
      business_phone: s.business_phone ?? '',
      tax_percent: Number(s.tax_percent ?? 0),
      reservation_window_minutes: Number(s.reservation_window_minutes ?? 15),
    };
  },

  async update(input: Partial<BusinessSettings>): Promise<BusinessSettings> {
    await withTransaction(async (client) => {
      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) await settingsRepository.set(key, String(value), client);
      }
    });
    emitEvent('dashboard:updated');
    return this.get();
  },

  listPricing() {
    return pricingRepository.list();
  },

  /** New sessions pick up the new rate; existing sessions keep their stored rate. */
  async updatePricing(consoleType: ConsoleType, hourlyRate: number) {
    const row = await pricingRepository.update(consoleType, hourlyRate);
    if (!row) throw notFound(`No pricing configured for ${consoleType}`);
    emitEvent('console:updated');
    return row;
  },
};
