import { query, type Queryable } from '../config/db.js';
import type { ConsoleType, Invoice, PaymentStatus, SessionStatus } from '../types/index.js';

/**
 * Invoice with everything needed to display/print it. An invoice is either for
 * a gaming session (session fields set) or for a membership sale (membership_*
 * fields set) — kind tells which.
 */
export interface InvoiceView extends Invoice {
  kind: 'SESSION' | 'MEMBERSHIP';
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  // session invoices
  console_number: string | null;
  console_type: ConsoleType | null;
  start_datetime: Date | null;
  end_datetime: Date | null;
  actual_end_datetime: Date | null;
  duration_minutes: number | null;
  hourly_rate: number | null;
  session_status: SessionStatus | null;
  /** Minutes paid for by a membership (session played on a package). */
  membership_minutes: number | null;
  // membership-sale invoices (and the package a session was played on)
  membership_name: string | null;
  membership_minutes_total: number | null;
  membership_expires_at: Date | null;
  amount_paid: number;
}

const VIEW_SELECT = `
  SELECT i.*,
         CASE WHEN i.membership_id IS NOT NULL THEN 'MEMBERSHIP' ELSE 'SESSION' END AS kind,
         cu.name AS customer_name, cu.phone AS customer_phone, cu.email AS customer_email,
         co.console_number, co.console_type,
         s.start_datetime, s.end_datetime, s.actual_end_datetime, s.duration_minutes, s.hourly_rate,
         s.status AS session_status, s.membership_minutes,
         m.plan_name AS membership_name, m.minutes_total AS membership_minutes_total, m.expires_at AS membership_expires_at,
         COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS amount_paid
  FROM invoices i
  JOIN customers cu ON cu.id = i.customer_id
  LEFT JOIN sessions s ON s.id = i.session_id
  LEFT JOIN consoles co ON co.id = s.console_id
  LEFT JOIN memberships m ON m.id = COALESCE(i.membership_id, s.membership_id)`;

export interface InvoiceFilters {
  search?: string;
  from?: Date;
  to?: Date;
  paymentStatus?: PaymentStatus;
  customerId?: string;
}

export const invoiceRepository = {
  /** Atomically allocates the next per-day sequence number. */
  async nextSequence(businessDate: string, db: Queryable): Promise<number> {
    const { rows } = await query<{ last_value: number }>(
      `INSERT INTO invoice_counters (business_date, last_value) VALUES ($1, 1)
       ON CONFLICT (business_date) DO UPDATE SET last_value = invoice_counters.last_value + 1
       RETURNING last_value`,
      [businessDate],
      db,
    );
    return rows[0].last_value;
  },

  /**
   * Inserts the invoice unless the session already has one. Returns null when an
   * invoice already existed — this is what makes invoice generation idempotent.
   */
  async insertIfAbsent(
    input: {
      invoice_number: string;
      session_id: string;
      customer_id: string;
      subtotal: number;
      discount: number;
      tax: number;
      total: number;
      payment_status: PaymentStatus;
    },
    db: Queryable,
  ): Promise<Invoice | null> {
    const { rows } = await query<Invoice>(
      `INSERT INTO invoices (invoice_number, session_id, customer_id, subtotal, discount, tax, total, payment_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (session_id) DO NOTHING
       RETURNING *`,
      [
        input.invoice_number,
        input.session_id,
        input.customer_id,
        input.subtotal,
        input.discount,
        input.tax,
        input.total,
        input.payment_status,
      ],
      db,
    );
    return rows[0] ?? null;
  },

  /** Invoice for a membership sale (one per membership, enforced by a UNIQUE constraint). */
  async insertForMembership(
    input: {
      invoice_number: string;
      membership_id: string;
      customer_id: string;
      subtotal: number;
      discount: number;
      tax: number;
      total: number;
      payment_status: PaymentStatus;
    },
    db: Queryable,
  ): Promise<Invoice> {
    const { rows } = await query<Invoice>(
      `INSERT INTO invoices (invoice_number, membership_id, customer_id, subtotal, discount, tax, total, payment_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [input.invoice_number, input.membership_id, input.customer_id, input.subtotal, input.discount, input.tax, input.total, input.payment_status],
      db,
    );
    return rows[0];
  },

  async findBySession(sessionId: string, db?: Queryable): Promise<Invoice | null> {
    const { rows } = await query<Invoice>(`SELECT * FROM invoices WHERE session_id = $1`, [sessionId], db);
    return rows[0] ?? null;
  },

  async findView(id: string, db?: Queryable): Promise<InvoiceView | null> {
    const { rows } = await query<InvoiceView>(`${VIEW_SELECT} WHERE i.id = $1`, [id], db);
    return rows[0] ?? null;
  },

  async lockById(id: string, db: Queryable): Promise<Invoice | null> {
    const { rows } = await query<Invoice>(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [id], db);
    return rows[0] ?? null;
  },

  async update(
    id: string,
    fields: Partial<Pick<Invoice, 'discount' | 'tax' | 'total' | 'payment_status'>>,
    db: Queryable,
  ): Promise<Invoice> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`);
    const { rows } = await query<Invoice>(
      `UPDATE invoices SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...entries.map(([, v]) => v)],
      db,
    );
    return rows[0];
  },

  async list(filters: InvoiceFilters, limit: number, offset: number, db?: Queryable) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (filters.search) {
      add(
        `(lower(i.invoice_number) LIKE '%' || lower(?) || '%' OR lower(cu.name) LIKE '%' || lower(?) || '%' OR cu.phone LIKE '%' || ? || '%')`,
        filters.search,
      );
    }
    if (filters.from) add('i.created_at >= ?', filters.from);
    if (filters.to) add('i.created_at < ?', filters.to);
    if (filters.paymentStatus) add('i.payment_status = ?', filters.paymentStatus);
    if (filters.customerId) add('i.customer_id = ?', filters.customerId);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const count = await query<{ total: number; amount: number }>(
      `SELECT count(*) AS total, COALESCE(sum(i.total), 0) AS amount
       FROM invoices i JOIN customers cu ON cu.id = i.customer_id ${whereSql}`,
      params,
      db,
    );
    const { rows } = await query<InvoiceView>(
      `${VIEW_SELECT} ${whereSql} ORDER BY i.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
      db,
    );
    return { rows, total: count.rows[0].total, totalAmount: count.rows[0].amount };
  },
};
