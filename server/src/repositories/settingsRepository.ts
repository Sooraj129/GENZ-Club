import { query, type Queryable } from '../config/db.js';
import type { ConsoleType } from '../types/index.js';

export interface PricingRow {
  id: string;
  console_type: ConsoleType;
  hourly_rate: number;
  updated_at: Date;
}

export const pricingRepository = {
  async list(db?: Queryable): Promise<PricingRow[]> {
    const { rows } = await query<PricingRow>(
      `SELECT id, console_type, hourly_rate, updated_at FROM pricing ORDER BY console_type`,
      [],
      db,
    );
    return rows;
  },

  async update(consoleType: ConsoleType, hourlyRate: number, db?: Queryable): Promise<PricingRow | null> {
    const { rows } = await query<PricingRow>(
      `UPDATE pricing SET hourly_rate = $2, updated_at = now() WHERE console_type = $1
       RETURNING id, console_type, hourly_rate, updated_at`,
      [consoleType, hourlyRate],
      db,
    );
    return rows[0] ?? null;
  },
};

export const settingsRepository = {
  async getAll(db?: Queryable): Promise<Record<string, string>> {
    const { rows } = await query<{ key: string; value: string }>(`SELECT key, value FROM settings`, [], db);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },

  async set(key: string, value: string, db?: Queryable): Promise<void> {
    await query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value],
      db,
    );
  },
};
