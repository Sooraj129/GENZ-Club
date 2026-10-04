import { query, type Queryable } from '../config/db.js';
import type { Payment, PaymentMethod } from '../types/index.js';

export interface PaymentView extends Payment {
  invoice_number: string;
  invoice_total: number;
  customer_name: string;
  customer_phone: string;
  processed_by_name: string | null;
}

const VIEW_SELECT = `
  SELECT p.id, p.invoice_id, p.amount, p.payment_method, p.reference, p.paid_at, p.processed_by, p.created_at,
         i.invoice_number, i.total AS invoice_total,
         cu.name AS customer_name, cu.phone AS customer_phone, u.name AS processed_by_name
  FROM payments p
  JOIN invoices i ON i.id = p.invoice_id
  JOIN customers cu ON cu.id = i.customer_id
  LEFT JOIN users u ON u.id = p.processed_by`;

export const paymentRepository = {
  async insert(
    input: {
      invoice_id: string;
      amount: number;
      payment_method: PaymentMethod;
      reference: string | null;
      idempotency_key: string | null;
      processed_by: string;
    },
    db: Queryable,
  ): Promise<Payment> {
    const { rows } = await query<Payment>(
      `INSERT INTO payments (invoice_id, amount, payment_method, reference, idempotency_key, processed_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, invoice_id, amount, payment_method, reference, paid_at, processed_by, created_at`,
      [input.invoice_id, input.amount, input.payment_method, input.reference, input.idempotency_key, input.processed_by],
      db,
    );
    return rows[0];
  },

  async findByIdempotencyKey(key: string, db?: Queryable): Promise<Payment | null> {
    const { rows } = await query<Payment>(
      `SELECT id, invoice_id, amount, payment_method, reference, paid_at, processed_by, created_at
       FROM payments WHERE idempotency_key = $1`,
      [key],
      db,
    );
    return rows[0] ?? null;
  },

  async sumForInvoice(invoiceId: string, db?: Queryable): Promise<number> {
    const { rows } = await query<{ paid: number }>(
      `SELECT COALESCE(sum(amount), 0) AS paid FROM payments WHERE invoice_id = $1`,
      [invoiceId],
      db,
    );
    return rows[0].paid;
  },

  async findView(id: string, db?: Queryable): Promise<PaymentView | null> {
    const { rows } = await query<PaymentView>(`${VIEW_SELECT} WHERE p.id = $1`, [id], db);
    return rows[0] ?? null;
  },

  async listForInvoice(invoiceId: string, db?: Queryable): Promise<PaymentView[]> {
    const { rows } = await query<PaymentView>(`${VIEW_SELECT} WHERE p.invoice_id = $1 ORDER BY p.paid_at`, [invoiceId], db);
    return rows;
  },

  async list(
    filters: { from?: Date; to?: Date; method?: PaymentMethod; search?: string },
    limit: number,
    offset: number,
    db?: Queryable,
  ) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (filters.from) add('p.paid_at >= ?', filters.from);
    if (filters.to) add('p.paid_at < ?', filters.to);
    if (filters.method) add('p.payment_method = ?', filters.method);
    if (filters.search) {
      add(
        `(lower(i.invoice_number) LIKE '%' || lower(?) || '%' OR lower(cu.name) LIKE '%' || lower(?) || '%' OR cu.phone LIKE '%' || ? || '%')`,
        filters.search,
      );
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const count = await query<{ total: number; amount: number }>(
      `SELECT count(*) AS total, COALESCE(sum(p.amount), 0) AS amount FROM payments p
       JOIN invoices i ON i.id = p.invoice_id JOIN customers cu ON cu.id = i.customer_id ${whereSql}`,
      params,
      db,
    );
    const { rows } = await query<PaymentView>(
      `${VIEW_SELECT} ${whereSql} ORDER BY p.paid_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
      db,
    );
    return { rows, total: count.rows[0].total, totalAmount: count.rows[0].amount };
  },

  async update(id: string, fields: Partial<{ payment_method: PaymentMethod; reference: string | null }>, db?: Queryable) {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`);
    await query(`UPDATE payments SET ${sets.join(', ')} WHERE id = $1`, [id, ...entries.map(([, v]) => v)], db);
  },
};
