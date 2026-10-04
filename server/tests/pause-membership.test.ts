import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/config/db.js';
import { invoiceService } from '../src/services/invoiceService.js';
import { membershipService } from '../src/services/membershipService.js';
import { reportService } from '../src/services/reportService.js';
import { sessionService } from '../src/services/sessionService.js';
import type { AuthUser } from '../src/types/index.js';
import { businessDate } from '../src/utils/time.js';
import { count, createConsole, createCustomer, createUser, minutesFromNow } from './helpers.js';

let staff: AuthUser;
let customer: { id: string };

beforeAll(async () => {
  staff = await createUser('STAFF');
  customer = await createCustomer('Pause Tester');
});

const book = (consoleId: string, startMin: number, endMin: number, membershipId?: string, customerId = customer.id) =>
  sessionService.create(
    { customer_id: customerId, console_id: consoleId, start: minutesFromNow(startMin), end: minutesFromNow(endMin), membership_id: membershipId },
    staff,
  );

async function consoleStatus(id: string) {
  const { rows } = await pool.query('SELECT status FROM consoles WHERE id = $1', [id]);
  return rows[0].status;
}

describe('pause / resume', () => {
  it('pausing saves played minutes, stops the clock and frees the console', async () => {
    const c = await createConsole('PS5');
    const s = await book(c.id, -60, 60); // booked 2h, played 1h so far
    const paused = await sessionService.pause(s.id);
    expect(paused.status).toBe('PAUSED');
    expect(paused.played_minutes).toBe(60);
    expect(paused.paused_at).toBeTruthy();
    expect(await consoleStatus(c.id)).toBe('AVAILABLE');
    // Shows up in the Paused list (what the Active Sessions page loads), not in the playing list.
    expect((await sessionService.listPaused()).map((x) => x.id)).toContain(s.id);
    expect((await sessionService.listActive()).map((x) => x.id)).not.toContain(s.id);

    // Someone else can use the console while it's paused.
    const other = await createCustomer('Walk-in');
    await expect(book(c.id, -1, 30, undefined, other.id)).resolves.toMatchObject({ status: 'ACTIVE' });
  });

  it('resumes for the remaining time and bills only time actually played', async () => {
    const c = await createConsole('PS5');
    const s = await book(c.id, -60, 60);
    await sessionService.pause(s.id);

    const resumed = await sessionService.resume(s.id);
    expect(resumed.status).toBe('ACTIVE');
    const remaining = (resumed.end_datetime.getTime() - resumed.segment_start_datetime.getTime()) / 60_000;
    expect(remaining).toBe(60);
    expect(await consoleStatus(c.id)).toBe('PLAYING');

    // Customer leaves right after resuming: 60 played minutes in total → ₹140.
    const ended = await sessionService.end(s.id);
    expect(ended.duration_minutes).toBe(60);
    expect(ended.final_amount).toBe(140);
  });

  it('ending a paused session bills the minutes played before the pause', async () => {
    const c = await createConsole('PS4');
    const s = await book(c.id, -30, 90);
    await sessionService.pause(s.id);
    const ended = await sessionService.end(s.id);
    expect(ended.status).toBe('COMPLETED');
    expect(ended.duration_minutes).toBe(30);
    expect(ended.final_amount).toBe(60); // PS4 30 min
    expect(ended.invoice_number).toBeTruthy();
  });

  it('will not resume onto a console that is busy, but can resume on another free one of the same type', async () => {
    const a = await createConsole('PS5');
    const b = await createConsole('PS5');
    const s = await book(a.id, -60, 60);
    await sessionService.pause(s.id);
    const other = await createCustomer('Took the console');
    await book(a.id, -1, 120, undefined, other.id);

    await expect(sessionService.resume(s.id)).rejects.toThrow('not free');
    const moved = await sessionService.resume(s.id, b.id);
    expect(moved.console_id).toBe(b.id);
    expect(moved.status).toBe('ACTIVE');
  });

  it('refuses to resume on a different console type', async () => {
    const ps5 = await createConsole('PS5');
    const ps4 = await createConsole('PS4');
    const s = await book(ps5.id, -30, 60);
    await sessionService.pause(s.id);
    await expect(sessionService.resume(s.id, ps4.id)).rejects.toThrow('PS5');
  });

  it('extending a paused session adds booked time without needing the console', async () => {
    const c = await createConsole('PS5');
    const s = await book(c.id, -30, 30); // 60 booked
    await sessionService.pause(s.id);
    const extended = await sessionService.extend(s.id, 30);
    expect(extended.booked_minutes).toBe(90);
    expect(extended.status).toBe('PAUSED');
  });

  it('paused sessions are not expired by the monitor and cannot be cancelled', async () => {
    const c = await createConsole('PS5');
    const s = await book(c.id, -30, 30);
    await sessionService.pause(s.id);
    expect(await sessionService.expire(s.id)).toBe(false);
    await expect(sessionService.cancel(s.id)).rejects.toThrow('use End Session');
  });
});

describe('membership packages', () => {
  async function plan(hours: number, consoleType: 'PS4' | 'PS5' | null = null, price = 799) {
    return membershipService.createPlan({
      name: `Pack ${Math.random().toString(36).slice(2, 8)}`,
      price,
      minutes: hours * 60,
      console_type: consoleType,
      validity_days: 30,
    });
  }

  it('selling a membership creates a pending invoice for its price', async () => {
    const p = await plan(6);
    const { membership, invoice } = await membershipService.sell(customer.id, p.id, staff);
    expect(membership.minutes_left).toBe(360);
    expect(membership.state).toBe('ACTIVE');
    expect(invoice.total).toBe(799);
    expect(invoice.payment_status).toBe('PENDING');
    const view = await invoiceService.get(invoice.id);
    expect(view.kind).toBe('MEMBERSHIP');
    expect(view.membership_name).toBe(p.name);
  });

  it('a session on a membership uses its hours — nothing to pay', async () => {
    const p = await plan(6);
    const { membership } = await membershipService.sell(customer.id, p.id, staff);
    const c = await createConsole('PS5');
    const s = await book(c.id, -120, -60, membership.id); // 60 min, already over → settled immediately
    expect(s.status).toBe('EXPIRED');
    expect(s.membership_minutes).toBe(60);
    expect(s.final_amount).toBe(0);
    expect(s.payment_status).toBe('PAID');
    expect((await membershipService.get(membership.id)).minutes_left).toBe(300);
  });

  it('time beyond the membership balance is billed at the hourly rate', async () => {
    const p = await membershipService.createPlan({ name: `Tiny ${Date.now()}`, price: 50, minutes: 30, console_type: null, validity_days: 30 });
    const { membership } = await membershipService.sell(customer.id, p.id, staff);
    const c = await createConsole('PS5');
    const s = await book(c.id, -120, -60, membership.id); // 60 min played, 30 covered
    expect(s.membership_minutes).toBe(30);
    expect(s.final_amount).toBe(70); // 30 min of PS5
    expect((await membershipService.get(membership.id)).state).toBe('USED_UP');
  });

  it('pause/resume on a membership deducts only minutes actually played', async () => {
    const p = await plan(2);
    const { membership } = await membershipService.sell(customer.id, p.id, staff);
    const c = await createConsole('PS5');
    const s = await book(c.id, -45, 75, membership.id);
    await sessionService.pause(s.id);
    const ended = await sessionService.end(s.id);
    expect(ended.membership_minutes).toBe(45);
    expect(ended.final_amount).toBe(0);
    expect((await membershipService.get(membership.id)).minutes_left).toBe(75);
  });

  it('rejects memberships for the wrong console type, another customer, or after expiry', async () => {
    const ps4Only = await plan(5, 'PS4');
    const { membership } = await membershipService.sell(customer.id, ps4Only.id, staff);
    const ps5 = await createConsole('PS5');
    await expect(book(ps5.id, 60, 120, membership.id)).rejects.toThrow('only valid on PS4');

    const someoneElse = await createCustomer('Not the owner');
    const ps4 = await createConsole('PS4');
    await expect(book(ps4.id, 60, 120, membership.id, someoneElse.id)).rejects.toThrow('does not belong');

    await pool.query(`UPDATE memberships SET purchased_at = now() - interval '40 days', expires_at = now() - interval '1 day' WHERE id = $1`, [membership.id]);
    await expect(book(ps4.id, 60, 120, membership.id)).rejects.toThrow('expired');
  });

  it('cancelling an unused membership invoice cancels the membership; a used one cannot be cancelled', async () => {
    const p = await plan(3);
    const unused = await membershipService.sell(customer.id, p.id, staff);
    await invoiceService.cancel(unused.invoice.id);
    expect((await membershipService.get(unused.membership.id)).state).toBe('CANCELLED');

    const used = await membershipService.sell(customer.id, p.id, staff);
    const c = await createConsole('PS5');
    await book(c.id, -60, -30, used.membership.id);
    await expect(invoiceService.cancel(used.invoice.id)).rejects.toThrow('already been used');
  });

  it('membership sales count as revenue in reports', async () => {
    const p = await plan(1, null, 500);
    await membershipService.sell(customer.id, p.id, staff);
    const today = businessDate();
    const r = await reportService.report(today, today, 'day');
    expect(r.summary.membership_revenue).toBeGreaterThanOrEqual(500);
    expect(await count(`SELECT 1 FROM invoices WHERE membership_id IS NOT NULL`)).toBeGreaterThan(0);
  });
});
