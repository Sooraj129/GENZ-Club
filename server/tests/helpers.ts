import { pool } from '../src/config/db.js';
import { authService } from '../src/services/authService.js';
import type { AuthUser } from '../src/types/index.js';

const MIN = 60_000;
export const minutesFromNow = (m: number) => new Date(Math.round((Date.now() + m * MIN) / 1000) * 1000);

let counter = 0;

export async function createUser(role: 'ADMIN' | 'STAFF' = 'STAFF'): Promise<AuthUser> {
  counter++;
  const email = `${role.toLowerCase()}${counter}-${Date.now()}@test.local`;
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role`,
    [`${role} ${counter}`, email, await authService.hashPassword('Passw0rd!'), role],
  );
  return rows[0];
}

export async function createCustomer(name = 'Test Customer') {
  counter++;
  const phone = `9${String(100000000 + counter * 7919 + (Date.now() % 1000)).slice(-9)}`;
  const { rows } = await pool.query(
    `INSERT INTO customers (name, phone) VALUES ($1, $2) RETURNING *`,
    [name, phone],
  );
  return rows[0] as { id: string; name: string; phone: string };
}

export async function createConsole(type: 'PS4' | 'PS5' = 'PS5', status = 'AVAILABLE') {
  counter++;
  const { rows } = await pool.query(
    `INSERT INTO consoles (console_number, console_type, status) VALUES ($1, $2, $3) RETURNING id, console_number`,
    [`${type}-T${counter}`, type, status],
  );
  return rows[0] as { id: string; console_number: string };
}

/** Inserts an ACTIVE session directly (bypassing the service) to simulate state left behind by a crash/restart. */
export async function insertActiveSession(customerId: string, consoleId: string, start: Date, end: Date, rate = 140) {
  const { rows } = await pool.query(
    `INSERT INTO sessions (customer_id, console_id, start_datetime, segment_start_datetime, end_datetime,
                           booked_minutes, hourly_rate, estimated_amount, status)
     VALUES ($1, $2, $3, $3, $4, $5, $6, 0, 'ACTIVE') RETURNING id`,
    [customerId, consoleId, start, end, Math.round((end.getTime() - start.getTime()) / 60_000), rate],
  );
  return rows[0].id as string;
}

export async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM (${sql}) x`, params);
  return rows[0].n;
}
