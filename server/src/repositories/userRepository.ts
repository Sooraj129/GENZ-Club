import { query, type Queryable } from '../config/db.js';
import type { Role, User } from '../types/index.js';

const COLUMNS = 'id, name, email, role, is_active, created_at, updated_at';

export const userRepository = {
  async findByEmailWithHash(email: string, db?: Queryable) {
    const { rows } = await query<User & { password_hash: string }>(
      `SELECT ${COLUMNS}, password_hash FROM users WHERE lower(email) = lower($1)`,
      [email],
      db,
    );
    return rows[0] ?? null;
  },

  async findById(id: string, db?: Queryable): Promise<User | null> {
    const { rows } = await query<User>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id], db);
    return rows[0] ?? null;
  },

  async list(db?: Queryable): Promise<User[]> {
    const { rows } = await query<User>(`SELECT ${COLUMNS} FROM users ORDER BY created_at`, [], db);
    return rows;
  },

  async create(
    input: { name: string; email: string; passwordHash: string; role: Role },
    db?: Queryable,
  ): Promise<User> {
    const { rows } = await query<User>(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
      [input.name, input.email.toLowerCase(), input.passwordHash, input.role],
      db,
    );
    return rows[0];
  },

  async update(
    id: string,
    fields: Partial<{ name: string; email: string; password_hash: string; role: Role; is_active: boolean }>,
    db?: Queryable,
  ): Promise<User | null> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return this.findById(id, db);
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`);
    const { rows } = await query<User>(
      `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, ...entries.map(([, v]) => v)],
      db,
    );
    return rows[0] ?? null;
  },

  async countActiveAdmins(db?: Queryable): Promise<number> {
    const { rows } = await query<{ count: number }>(
      `SELECT count(*) AS count FROM users WHERE role = 'ADMIN' AND is_active`,
      [],
      db,
    );
    return rows[0].count;
  },
};
