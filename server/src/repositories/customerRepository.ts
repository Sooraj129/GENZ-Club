import { query, type Queryable } from '../config/db.js';
import type { Customer } from '../types/index.js';

const COLUMNS = 'id, name, phone, email, created_at, updated_at';

export interface CustomerListItem extends Customer {
  total_sessions: number;
  total_spent: number;
  last_visit: Date | null;
}

const STATS_SELECT = `
  c.id, c.name, c.phone, c.email, c.created_at, c.updated_at,
  COALESCE(s.total_sessions, 0) AS total_sessions,
  COALESCE(i.total_spent, 0) AS total_spent,
  s.last_visit
  FROM customers c
  LEFT JOIN LATERAL (
    SELECT count(*) AS total_sessions, max(start_datetime) AS last_visit
    FROM sessions WHERE customer_id = c.id AND status <> 'CANCELLED'
  ) s ON TRUE
  LEFT JOIN LATERAL (
    SELECT sum(total) AS total_spent
    FROM invoices WHERE customer_id = c.id AND payment_status <> 'CANCELLED'
  ) i ON TRUE`;

export const customerRepository = {
  async create(input: { name: string; phone: string; email: string | null }, db?: Queryable): Promise<Customer> {
    const { rows } = await query<Customer>(
      `INSERT INTO customers (name, phone, email) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
      [input.name, input.phone, input.email],
      db,
    );
    return rows[0];
  },

  async findById(id: string, db?: Queryable): Promise<Customer | null> {
    const { rows } = await query<Customer>(`SELECT ${COLUMNS} FROM customers WHERE id = $1`, [id], db);
    return rows[0] ?? null;
  },

  async findByPhone(phone: string, db?: Queryable): Promise<Customer | null> {
    const { rows } = await query<Customer>(`SELECT ${COLUMNS} FROM customers WHERE phone = $1`, [phone], db);
    return rows[0] ?? null;
  },

  async findWithStats(id: string, db?: Queryable): Promise<CustomerListItem | null> {
    const { rows } = await query<CustomerListItem>(`SELECT ${STATS_SELECT} WHERE c.id = $1`, [id], db);
    return rows[0] ?? null;
  },

  async list(opts: { search?: string; limit: number; offset: number }, db?: Queryable) {
    const params: unknown[] = [];
    let where = '';
    if (opts.search) {
      params.push(`%${opts.search.toLowerCase()}%`);
      where = `WHERE lower(c.name) LIKE $1 OR c.phone LIKE $1 OR lower(coalesce(c.email, '')) LIKE $1`;
    }
    const count = await query<{ total: number }>(`SELECT count(*) AS total FROM customers c ${where}`, params, db);
    const { rows } = await query<CustomerListItem>(
      `SELECT ${STATS_SELECT} ${where}
       ORDER BY c.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.limit, opts.offset],
      db,
    );
    return { rows, total: count.rows[0].total };
  },

  /** Quick lookup by name or phone for the booking form. Phone prefix matches rank first. */
  async search(term: string, limit: number, db?: Queryable): Promise<Customer[]> {
    const { rows } = await query<Customer>(
      `SELECT ${COLUMNS} FROM customers
       WHERE phone LIKE $1 || '%' OR phone LIKE '%' || $1 || '%' OR lower(name) LIKE '%' || lower($1) || '%'
       ORDER BY (phone LIKE $1 || '%') DESC, (lower(name) LIKE lower($1) || '%') DESC, name
       LIMIT $2`,
      [term, limit],
      db,
    );
    return rows;
  },

  async update(
    id: string,
    fields: Partial<{ name: string; phone: string; email: string | null }>,
    db?: Queryable,
  ): Promise<Customer | null> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return this.findById(id, db);
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`);
    const { rows } = await query<Customer>(
      `UPDATE customers SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, ...entries.map(([, v]) => v)],
      db,
    );
    return rows[0] ?? null;
  },
};
