import { beforeAll, describe, expect, it } from 'vitest';
import { pool, withTransaction } from '../src/config/db.js';
import { runSessionMonitorTick } from '../src/jobs/sessionMonitor.js';
import { sessionService } from '../src/services/sessionService.js';
import { settingsService } from '../src/services/settingsService.js';
import type { AuthUser } from '../src/types/index.js';
import { count, createConsole, createCustomer, createUser, insertActiveSession, minutesFromNow } from './helpers.js';

let staff: AuthUser;
let customer: { id: string };

beforeAll(async () => {
  staff = await createUser('STAFF');
  customer = await createCustomer('John');
});

const book = (consoleId: string, startMin: number, endMin: number) =>
  sessionService.create(
    { customer_id: customer.id, console_id: consoleId, start: minutesFromNow(startMin), end: minutesFromNow(endMin) },
    staff,
  );

async function consoleStatus(id: string) {
  const { rows } = await pool.query('SELECT status FROM consoles WHERE id = $1', [id]);
  return rows[0].status;
}

describe('booking rules', () => {
  it('creates a future booking as SCHEDULED with the estimate from current pricing', async () => {
    const c = await createConsole('PS5');
    const s = await book(c.id, 120, 240);
    expect(s.status).toBe('SCHEDULED');
    expect(s.hourly_rate).toBe(140);
    expect(s.estimated_amount).toBe(280);
  });

  it('prevents overlapping bookings on the same console', async () => {
    const c = await createConsole('PS5');
    await book(c.id, 120, 240); // e.g. 6:00 → 8:00
    await expect(book(c.id, 180, 300)).rejects.toThrow(`${c.console_number} is already booked during the selected time.`);
    await expect(book(c.id, 60, 400)).rejects.toThrow('already booked');
  });

  it('allows back-to-back and non-overlapping bookings', async () => {
    const c = await createConsole('PS5');
    await book(c.id, 120, 240);
    await expect(book(c.id, 240, 300)).resolves.toMatchObject({ status: 'SCHEDULED' });
    await expect(book(c.id, 60, 120)).resolves.toMatchObject({ status: 'SCHEDULED' });
  });

  it('allows the same time slot on a different console', async () => {
    const a = await createConsole('PS5');
    const b = await createConsole('PS5');
    await book(a.id, 120, 240);
    await expect(book(b.id, 120, 240)).resolves.toBeTruthy();
  });

  it('refuses to book a console under maintenance', async () => {
    const c = await createConsole('PS4', 'MAINTENANCE');
    await expect(book(c.id, 60, 120)).rejects.toThrow('under maintenance');
  });

  it('rejects an end time before the start time', async () => {
    const c = await createConsole('PS5');
    await expect(book(c.id, 120, 60)).rejects.toThrow('End time must be after start time');
  });

  it('lets only one of two simultaneous bookings for the same slot succeed', async () => {
    const c = await createConsole('PS5');
    const results = await Promise.allSettled([book(c.id, 120, 240), book(c.id, 150, 270), book(c.id, 120, 240)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await count(`SELECT 1 FROM sessions WHERE console_id = $1 AND status IN ('SCHEDULED','ACTIVE')`, [c.id])).toBe(1);
  });

  it('enforces no-overlap in the database even if the service check is bypassed', async () => {
    const c = await createConsole('PS5');
    await insertActiveSession(customer.id, c.id, minutesFromNow(-10), minutesFromNow(50));
    await expect(
      withTransaction((client) =>
        client.query(
          `INSERT INTO sessions (customer_id, console_id, start_datetime, segment_start_datetime, end_datetime,
                                booked_minutes, hourly_rate, estimated_amount, status)
           VALUES ($1, $2, $3, $3, $4, 30, 140, 0, 'SCHEDULED')`,
          [customer.id, c.id, minutesFromNow(0), minutesFromNow(30)],
        ),
      ),
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it('new bookings use updated pricing while existing sessions keep their rate', async () => {
    const c = await createConsole('PS5');
    const before = await book(c.id, 120, 180);
    await settingsService.updatePricing('PS5', 150);
    const after = await book(c.id, 300, 360);
    await settingsService.updatePricing('PS5', 140);
    expect(after.hourly_rate).toBe(150);
    expect(after.estimated_amount).toBe(150);
    expect((await sessionService.get(before.id)).hourly_rate).toBe(140);
  });
});

describe('session lifecycle', () => {
  it('starts a session immediately when the start time is now, marking the console PLAYING', async () => {
    const c = await createConsole('PS5');
    const s = await book(c.id, -1, 60);
    expect(s.status).toBe('ACTIVE');
    expect(await consoleStatus(c.id)).toBe('PLAYING');
  });

  it('starts a scheduled session early on request', async () => {
    const c = await createConsole('PS5');
    const s = await book(c.id, 30, 90);
    const started = await sessionService.start(s.id);
    expect(started.status).toBe('ACTIVE');
    expect(started.start_datetime.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await consoleStatus(c.id)).toBe('PLAYING');
  });

  it('ends a session early, billing actual time and generating one invoice', async () => {
    const c = await createConsole('PS5');
    const s = await book(c.id, -75, 45); // booked 2h, customer leaves after 1h15m
    const ended = await sessionService.end(s.id);
    expect(ended.status).toBe('COMPLETED');
    expect(ended.duration_minutes).toBe(75);
    expect(ended.final_amount).toBe(175);
    expect(ended.invoice_number).toMatch(/^GC-\d{8}-\d{4}$/);
    expect(ended.payment_status).toBe('PENDING');
    expect(await consoleStatus(c.id)).toBe('AVAILABLE');
    await expect(sessionService.end(s.id)).rejects.toThrow('Only playing or paused sessions');
    expect(await count('SELECT 1 FROM invoices WHERE session_id = $1', [s.id])).toBe(1);
  });

  it('extends a session when the console is free and recalculates the estimate', async () => {
    const c = await createConsole('PS5');
    const s = await book(c.id, -30, 90); // 2h
    const extended = await sessionService.extend(s.id, 60);
    expect(extended.end_datetime.getTime() - s.end_datetime.getTime()).toBe(60 * 60_000);
    expect(extended.estimated_amount).toBe(420);
  });

  it('refuses an extension that runs into the next booking', async () => {
    const c = await createConsole('PS5');
    const s = await book(c.id, -30, 90);
    await book(c.id, 120, 180);
    await expect(sessionService.extend(s.id, 60)).rejects.toThrow('booked by another session');
  });

  it('cancels a scheduled session and frees its slot', async () => {
    const c = await createConsole('PS5');
    const s = await book(c.id, 120, 180);
    expect((await sessionService.cancel(s.id)).status).toBe('CANCELLED');
    await expect(book(c.id, 120, 180)).resolves.toBeTruthy();
  });

  it('does not cancel an active session', async () => {
    const c = await createConsole('PS5');
    const s = await book(c.id, -10, 50);
    await expect(sessionService.cancel(s.id)).rejects.toThrow('use End Session');
  });

  it('immediately expires a booking whose end time has already passed', async () => {
    const c = await createConsole('PS4');
    const s = await book(c.id, -120, -60);
    expect(s.status).toBe('EXPIRED');
    expect(s.final_amount).toBe(120);
    expect(s.invoice_id).toBeTruthy();
    expect(await consoleStatus(c.id)).toBe('AVAILABLE');
  });
});

describe('background session monitor', () => {
  it('expires sessions left ACTIVE (e.g. after a restart), invoices once, and frees the console', async () => {
    const c = await createConsole('PS5');
    await pool.query(`UPDATE consoles SET status = 'PLAYING' WHERE id = $1`, [c.id]);
    const id = await insertActiveSession(customer.id, c.id, minutesFromNow(-90), minutesFromNow(-30));

    const first = await runSessionMonitorTick();
    expect(first.expired).toBeGreaterThanOrEqual(1);

    const s = await sessionService.get(id);
    expect(s.status).toBe('EXPIRED');
    expect(s.duration_minutes).toBe(60);
    expect(s.final_amount).toBe(140); // billed to booked end, not to when the monitor noticed
    expect(s.payment_status).toBe('PENDING');
    expect(await consoleStatus(c.id)).toBe('AVAILABLE');

    // Idempotent: further ticks (and direct calls) change nothing.
    await runSessionMonitorTick();
    expect(await sessionService.expire(id)).toBe(false);
    expect(await count('SELECT 1 FROM invoices WHERE session_id = $1', [id])).toBe(1);
  });

  it('concurrent expiry attempts produce exactly one invoice', async () => {
    const c = await createConsole('PS5');
    const id = await insertActiveSession(customer.id, c.id, minutesFromNow(-60), minutesFromNow(-1));
    const results = await Promise.all([sessionService.expire(id), sessionService.expire(id), sessionService.expire(id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await count('SELECT 1 FROM invoices WHERE session_id = $1', [id])).toBe(1);
  });

  it('activates scheduled sessions whose start time has arrived', async () => {
    const c = await createConsole('PS5');
    const s = await book(c.id, 60, 120);
    await pool.query(
      `UPDATE sessions SET start_datetime = now() - interval '1 minute' WHERE id = $1`,
      [s.id],
    );
    await runSessionMonitorTick();
    expect((await sessionService.get(s.id)).status).toBe('ACTIVE');
    expect(await consoleStatus(c.id)).toBe('PLAYING');
  });

  it('marks a console RESERVED when its next booking is within the reservation window', async () => {
    const c = await createConsole('PS5');
    await book(c.id, 10, 70);
    await runSessionMonitorTick();
    expect(await consoleStatus(c.id)).toBe('RESERVED');
  });
});
