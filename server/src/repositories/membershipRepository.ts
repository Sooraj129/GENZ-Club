import { query, type Queryable } from '../config/db.js';
import type { ConsoleType, Membership, MembershipPlan } from '../types/index.js';

/** Membership + derived fields the UI needs. */
export interface MembershipView extends Membership {
  customer_name: string;
  customer_phone: string;
  minutes_left: number;
  /** ACTIVE | USED_UP | EXPIRED | CANCELLED — derived, never stored. */
  state: 'ACTIVE' | 'USED_UP' | 'EXPIRED' | 'CANCELLED';
  invoice_id: string | null;
  invoice_number: string | null;
  payment_status: string | null;
}

const VIEW_SELECT = `
  SELECT m.*, cu.name AS customer_name, cu.phone AS customer_phone,
         (m.minutes_total - m.minutes_used) AS minutes_left,
         CASE
           WHEN m.status = 'CANCELLED' THEN 'CANCELLED'
           WHEN m.expires_at <= now() THEN 'EXPIRED'
           WHEN m.minutes_used >= m.minutes_total THEN 'USED_UP'
           ELSE 'ACTIVE'
         END AS state,
         i.id AS invoice_id, i.invoice_number, i.payment_status
  FROM memberships m
  JOIN customers cu ON cu.id = m.customer_id
  LEFT JOIN invoices i ON i.membership_id = m.id`;

export const membershipPlanRepository = {
  async list(includeInactive: boolean, db?: Queryable): Promise<MembershipPlan[]> {
    const { rows } = await query<MembershipPlan>(
      `SELECT * FROM membership_plans ${includeInactive ? '' : 'WHERE is_active'} ORDER BY price, name`,
      [],
      db,
    );
    return rows;
  },

  async findById(id: string, db?: Queryable): Promise<MembershipPlan | null> {
    const { rows } = await query<MembershipPlan>(`SELECT * FROM membership_plans WHERE id = $1`, [id], db);
    return rows[0] ?? null;
  },

  async create(
    input: { name: string; price: number; minutes: number; console_type: ConsoleType | null; validity_days: number },
    db?: Queryable,
  ): Promise<MembershipPlan> {
    const { rows } = await query<MembershipPlan>(
      `INSERT INTO membership_plans (name, price, minutes, console_type, validity_days)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.name, input.price, input.minutes, input.console_type, input.validity_days],
      db,
    );
    return rows[0];
  },

  async update(id: string, fields: Partial<Omit<MembershipPlan, 'id' | 'created_at' | 'updated_at'>>, db?: Queryable) {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (!entries.length) return this.findById(id, db);
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`);
    const { rows } = await query<MembershipPlan>(
      `UPDATE membership_plans SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...entries.map(([, v]) => v)],
      db,
    );
    return rows[0] ?? null;
  },
};

export const membershipRepository = {
  async insert(
    input: Pick<Membership, 'customer_id' | 'plan_id' | 'plan_name' | 'console_type' | 'minutes_total' | 'price' | 'expires_at' | 'created_by'>,
    db: Queryable,
  ): Promise<Membership> {
    const { rows } = await query<Membership>(
      `INSERT INTO memberships (customer_id, plan_id, plan_name, console_type, minutes_total, price, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [input.customer_id, input.plan_id, input.plan_name, input.console_type, input.minutes_total, input.price, input.expires_at, input.created_by],
      db,
    );
    return rows[0];
  },

  async findById(id: string, db?: Queryable): Promise<Membership | null> {
    const { rows } = await query<Membership>(`SELECT * FROM memberships WHERE id = $1`, [id], db);
    return rows[0] ?? null;
  },

  /** Row lock — used while deducting minutes so two sessions can't overspend the balance. */
  async lockById(id: string, db: Queryable): Promise<Membership | null> {
    const { rows } = await query<Membership>(`SELECT * FROM memberships WHERE id = $1 FOR UPDATE`, [id], db);
    return rows[0] ?? null;
  },

  async findView(id: string, db?: Queryable): Promise<MembershipView | null> {
    const { rows } = await query<MembershipView>(`${VIEW_SELECT} WHERE m.id = $1`, [id], db);
    return rows[0] ?? null;
  },

  async listForCustomer(customerId: string, db?: Queryable): Promise<MembershipView[]> {
    const { rows } = await query<MembershipView>(`${VIEW_SELECT} WHERE m.customer_id = $1 ORDER BY m.purchased_at DESC`, [customerId], db);
    return rows;
  },

  async list(filters: { search?: string; state?: string }, limit: number, offset: number, db?: Queryable) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.search) {
      params.push(filters.search);
      where.push(`(lower(cu.name) LIKE '%' || lower($${params.length}) || '%' OR cu.phone LIKE '%' || $${params.length} || '%' OR lower(m.plan_name) LIKE '%' || lower($${params.length}) || '%')`);
    }
    // state is derived, so filter on the outer query.
    const inner = `${VIEW_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
    const stateFilter = filters.state ? (params.push(filters.state), `WHERE v.state = $${params.length}`) : '';
    const count = await query<{ total: number }>(`SELECT count(*) AS total FROM (${inner}) v ${stateFilter}`, params, db);
    const { rows } = await query<MembershipView>(
      `SELECT * FROM (${inner}) v ${stateFilter} ORDER BY v.purchased_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
      db,
    );
    return { rows, total: count.rows[0].total };
  },

  async addMinutesUsed(id: string, minutes: number, db: Queryable): Promise<void> {
    await query(`UPDATE memberships SET minutes_used = minutes_used + $2, updated_at = now() WHERE id = $1`, [id, minutes], db);
  },

  async setStatus(id: string, status: 'ACTIVE' | 'CANCELLED', db: Queryable): Promise<void> {
    await query(`UPDATE memberships SET status = $2, updated_at = now() WHERE id = $1`, [id, status], db);
  },
};
