import { query, type Queryable } from '../config/db.js';
import type { ConsoleType, PaymentStatus, Session, SessionStatus, SessionView } from '../types/index.js';

const VIEW_SELECT = `
  SELECT s.*, cu.name AS customer_name, cu.phone AS customer_phone,
         co.console_number, co.console_type,
         i.id AS invoice_id, i.invoice_number, i.payment_status,
         m.plan_name AS membership_name
  FROM sessions s
  JOIN customers cu ON cu.id = s.customer_id
  JOIN consoles co ON co.id = s.console_id
  LEFT JOIN invoices i ON i.session_id = s.id
  LEFT JOIN memberships m ON m.id = s.membership_id`;

export interface SessionFilters {
  from?: Date;
  to?: Date;
  customer?: string;
  phone?: string;
  consoleId?: string;
  consoleType?: ConsoleType;
  customerId?: string;
  status?: SessionStatus;
  paymentStatus?: PaymentStatus;
}

export const sessionRepository = {
  async insert(
    input: {
      customer_id: string;
      console_id: string;
      start_datetime: Date;
      end_datetime: Date;
      booked_minutes: number;
      hourly_rate: number;
      estimated_amount: number;
      status: SessionStatus;
      membership_id: string | null;
      created_by: string;
    },
    db: Queryable,
  ): Promise<Session> {
    // A new session's first segment starts at its start time.
    const { rows } = await query<Session>(
      `INSERT INTO sessions (customer_id, console_id, start_datetime, segment_start_datetime, end_datetime,
                             booked_minutes, hourly_rate, estimated_amount, status, membership_id, created_by)
       VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        input.customer_id,
        input.console_id,
        input.start_datetime,
        input.end_datetime,
        input.booked_minutes,
        input.hourly_rate,
        input.estimated_amount,
        input.status,
        input.membership_id,
        input.created_by,
      ],
      db,
    );
    return rows[0];
  },

  async findView(id: string, db?: Queryable): Promise<SessionView | null> {
    const { rows } = await query<SessionView>(`${VIEW_SELECT} WHERE s.id = $1`, [id], db);
    return rows[0] ?? null;
  },

  async lockById(id: string, db: Queryable): Promise<Session | null> {
    const { rows } = await query<Session>(`SELECT * FROM sessions WHERE id = $1 FOR UPDATE`, [id], db);
    return rows[0] ?? null;
  },

  /**
   * First live booking on the console whose *current segment* overlaps [start, end).
   * (Paused sessions don't hold their console, so they never block.)
   */
  async findOverlap(
    consoleId: string,
    start: Date,
    end: Date,
    excludeSessionId: string | null,
    db?: Queryable,
  ): Promise<Session | null> {
    const { rows } = await query<Session>(
      `SELECT * FROM sessions
       WHERE console_id = $1
         AND status IN ('SCHEDULED', 'ACTIVE')
         AND tstzrange(segment_start_datetime, end_datetime, '[)') && tstzrange($2, $3, '[)')
         AND ($4::uuid IS NULL OR id <> $4::uuid)
       ORDER BY start_datetime LIMIT 1`,
      [consoleId, start, end, excludeSessionId],
      db,
    );
    return rows[0] ?? null;
  },

  async hasActive(consoleId: string, db?: Queryable): Promise<boolean> {
    const { rows } = await query(`SELECT 1 FROM sessions WHERE console_id = $1 AND status = 'ACTIVE' LIMIT 1`, [consoleId], db);
    return rows.length > 0;
  },

  async update(id: string, fields: Partial<Omit<Session, 'id' | 'created_at' | 'updated_at'>>, db: Queryable): Promise<Session> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`);
    const { rows } = await query<Session>(
      `UPDATE sessions SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...entries.map(([, v]) => v)],
      db,
    );
    return rows[0];
  },

  async listActive(db?: Queryable): Promise<SessionView[]> {
    const { rows } = await query<SessionView>(
      `${VIEW_SELECT} WHERE s.status = 'ACTIVE' ORDER BY s.end_datetime, s.start_datetime`,
      [],
      db,
    );
    return rows;
  },

  /** Paused sessions waiting to be resumed (or ended), oldest pause first. */
  async listPaused(db?: Queryable): Promise<SessionView[]> {
    const { rows } = await query<SessionView>(`${VIEW_SELECT} WHERE s.status = 'PAUSED' ORDER BY s.paused_at`, [], db);
    return rows;
  },

  async listUpcoming(limit: number, db?: Queryable): Promise<SessionView[]> {
    const { rows } = await query<SessionView>(
      `${VIEW_SELECT} WHERE s.status = 'SCHEDULED' ORDER BY s.start_datetime LIMIT $1`,
      [limit],
      db,
    );
    return rows;
  },

  /** Sessions for one console that hold its slot, for the availability preview. */
  async listLiveForConsole(consoleId: string, from: Date, to: Date, db?: Queryable): Promise<Session[]> {
    const { rows } = await query<Session>(
      `SELECT * FROM sessions
       WHERE console_id = $1 AND status IN ('SCHEDULED', 'ACTIVE')
         AND end_datetime > $2 AND segment_start_datetime < $3
       ORDER BY segment_start_datetime`,
      [consoleId, from, to],
      db,
    );
    return rows;
  },

  async list(filters: SessionFilters, limit: number, offset: number, db?: Queryable) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (filters.from) add('s.start_datetime >= ?', filters.from);
    if (filters.to) add('s.start_datetime < ?', filters.to);
    if (filters.customer) add(`lower(cu.name) LIKE '%' || lower(?) || '%'`, filters.customer);
    if (filters.phone) add(`cu.phone LIKE '%' || ? || '%'`, filters.phone);
    if (filters.customerId) add('s.customer_id = ?', filters.customerId);
    if (filters.consoleId) add('s.console_id = ?', filters.consoleId);
    if (filters.consoleType) add('co.console_type = ?', filters.consoleType);
    if (filters.status) add('s.status = ?', filters.status);
    if (filters.paymentStatus) add('i.payment_status = ?', filters.paymentStatus);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const count = await query<{ total: number }>(
      `SELECT count(*) AS total FROM sessions s
       JOIN customers cu ON cu.id = s.customer_id
       JOIN consoles co ON co.id = s.console_id
       LEFT JOIN invoices i ON i.session_id = s.id ${whereSql}`,
      params,
      db,
    );
    const { rows } = await query<SessionView>(
      `${VIEW_SELECT} ${whereSql} ORDER BY s.start_datetime DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
      db,
    );
    return { rows, total: count.rows[0].total };
  },

  /** IDs of scheduled sessions whose start time has arrived. */
  async dueToStart(at: Date, db?: Queryable): Promise<string[]> {
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM sessions WHERE status = 'SCHEDULED' AND start_datetime <= $1 ORDER BY start_datetime`,
      [at],
      db,
    );
    return rows.map((r) => r.id);
  },

  /** IDs of active sessions whose end time has passed. */
  async dueToExpire(at: Date, db?: Queryable): Promise<string[]> {
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM sessions WHERE status = 'ACTIVE' AND end_datetime <= $1 ORDER BY end_datetime`,
      [at],
      db,
    );
    return rows.map((r) => r.id);
  },
};
