import { query, type Queryable } from '../config/db.js';
import type { ConsoleStatus, ConsoleType, GameConsole } from '../types/index.js';

const SELECT = `
  SELECT c.id, c.console_number, c.console_type, c.hourly_rate AS rate_override,
         COALESCE(c.hourly_rate, p.hourly_rate) AS hourly_rate,
         c.status, c.created_at, c.updated_at
  FROM consoles c
  JOIN pricing p ON p.console_type = c.console_type`;

export interface ConsoleWithCurrent extends GameConsole {
  current_session_id: string | null;
  current_customer_name: string | null;
  current_end_datetime: Date | null;
  next_start_datetime: Date | null;
}

export const consoleRepository = {
  async list(db?: Queryable): Promise<ConsoleWithCurrent[]> {
    const { rows } = await query<ConsoleWithCurrent>(
      `SELECT x.*, cur.id AS current_session_id, cur.customer_name AS current_customer_name,
              cur.end_datetime AS current_end_datetime, nxt.start_datetime AS next_start_datetime
       FROM (${SELECT}) x
       LEFT JOIN LATERAL (
         SELECT s.id, s.end_datetime, cu.name AS customer_name
         FROM sessions s JOIN customers cu ON cu.id = s.customer_id
         WHERE s.console_id = x.id AND s.status = 'ACTIVE'
         ORDER BY s.start_datetime LIMIT 1
       ) cur ON TRUE
       LEFT JOIN LATERAL (
         SELECT s.start_datetime FROM sessions s
         WHERE s.console_id = x.id AND s.status = 'SCHEDULED'
         ORDER BY s.start_datetime LIMIT 1
       ) nxt ON TRUE
       ORDER BY x.console_type DESC, x.console_number`,
      [],
      db,
    );
    return rows;
  },

  async findById(id: string, db?: Queryable): Promise<GameConsole | null> {
    const { rows } = await query<GameConsole>(`${SELECT} WHERE c.id = $1`, [id], db);
    return rows[0] ?? null;
  },

  /** Locks the console row for the rest of the transaction (serializes bookings per console). */
  async lockById(id: string, db: Queryable): Promise<GameConsole | null> {
    const { rows } = await query<GameConsole>(`${SELECT} WHERE c.id = $1 FOR UPDATE OF c`, [id], db);
    return rows[0] ?? null;
  },

  async create(
    input: { console_number: string; console_type: ConsoleType; hourly_rate: number | null; status: ConsoleStatus },
    db?: Queryable,
  ): Promise<string> {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO consoles (console_number, console_type, hourly_rate, status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.console_number, input.console_type, input.hourly_rate, input.status],
      db,
    );
    return rows[0].id;
  },

  async update(
    id: string,
    fields: Partial<{ console_number: string; console_type: ConsoleType; hourly_rate: number | null; status: ConsoleStatus }>,
    db?: Queryable,
  ): Promise<boolean> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return true;
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`);
    const { rowCount } = await query(
      `UPDATE consoles SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
      [id, ...entries.map(([, v]) => v)],
      db,
    );
    return (rowCount ?? 0) > 0;
  },

  /**
   * Derives a console's operational status from its bookings and writes it if
   * it changed. Manual states (MAINTENANCE / DISABLED) are left untouched.
   * Returns the new status when it changed, otherwise null.
   */
  async syncStatus(id: string, at: Date, reservationWindowMinutes: number, db: Queryable): Promise<ConsoleStatus | null> {
    const { rows } = await query<{ status: ConsoleStatus }>(
      `WITH derived AS (
         SELECT CASE
           WHEN EXISTS (SELECT 1 FROM sessions WHERE console_id = $1 AND status = 'ACTIVE') THEN 'PLAYING'
           WHEN EXISTS (
             SELECT 1 FROM sessions WHERE console_id = $1 AND status = 'SCHEDULED'
               AND start_datetime <= $2::timestamptz + make_interval(mins => $3)
           ) THEN 'RESERVED'
           ELSE 'AVAILABLE'
         END AS status
       )
       UPDATE consoles c SET status = d.status, updated_at = now()
       FROM derived d
       WHERE c.id = $1 AND c.status NOT IN ('MAINTENANCE', 'DISABLED') AND c.status <> d.status
       RETURNING c.status`,
      [id, at, reservationWindowMinutes],
      db,
    );
    return rows[0]?.status ?? null;
  },

  async hasSessions(id: string, db?: Queryable): Promise<boolean> {
    const { rows } = await query(`SELECT 1 FROM sessions WHERE console_id = $1 LIMIT 1`, [id], db);
    return rows.length > 0;
  },

  async remove(id: string, db?: Queryable): Promise<void> {
    await query(`DELETE FROM consoles WHERE id = $1`, [id], db);
  },

  async listIds(db?: Queryable): Promise<string[]> {
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM consoles WHERE status NOT IN ('MAINTENANCE', 'DISABLED')`,
      [],
      db,
    );
    return rows.map((r) => r.id);
  },
};
