import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/config/db.js';
import { createApp } from '../src/app.js';
import { invoiceService } from '../src/services/invoiceService.js';
import { membershipService } from '../src/services/membershipService.js';
import { paymentService } from '../src/services/paymentService.js';
import { reportService } from '../src/services/reportService.js';
import { sessionService } from '../src/services/sessionService.js';
import type { AuthUser } from '../src/types/index.js';
import { businessDate } from '../src/utils/time.js';
import { createConsole, createCustomer, createUser, minutesFromNow } from './helpers.js';

let admin: AuthUser;
let customer: { id: string };

beforeAll(async () => {
  admin = await createUser('ADMIN');
  customer = await createCustomer('Corrections');
});

/** A finished 1-hour PS5 session → ₹140 invoice. */
async function finished() {
  const c = await createConsole('PS5');
  return sessionService.create({ customer_id: customer.id, console_id: c.id, start: minutesFromNow(-120), end: minutesFromNow(-60) }, admin);
}

describe('editing a session amount', () => {
  it('updates the session and invoice, and records who/why', async () => {
    const s = await finished();
    expect(s.final_amount).toBe(140);
    const edited = await sessionService.editAmount(s.id, { amount: 100 }, 'Regular customer discount', admin);
    expect(edited.final_amount).toBe(100);
    expect(edited.change_count).toBe(1);
    const inv = await invoiceService.get(s.invoice_id!);
    expect(inv.subtotal).toBe(100);
    expect(inv.total).toBe(100);
    const changes = await sessionService.changes(s.id);
    expect(changes[0]).toMatchObject({ action: 'EDIT', old_amount: 140, new_amount: 100, reason: 'Regular customer discount' });
    expect(changes[0].changed_by_name).toBe(admin.name);
  });

  it('keeps payment status right and refuses going below what was paid', async () => {
    const s = await finished();
    await paymentService.record({ invoice_id: s.invoice_id!, amount: 100, payment_method: 'CASH' }, admin);
    await expect(sessionService.editAmount(s.id, { amount: 80 }, 'too low', admin)).rejects.toThrow('already been paid');
    await sessionService.editAmount(s.id, { amount: 100 }, 'Matches cash received', admin);
    expect((await invoiceService.get(s.invoice_id!)).payment_status).toBe('PAID');
  });

  it('only edits finished sessions', async () => {
    const c = await createConsole('PS5');
    const live = await sessionService.create({ customer_id: customer.id, console_id: c.id, start: minutesFromNow(-10), end: minutesFromNow(50) }, admin);
    await expect(sessionService.editAmount(live.id, { amount: 50 }, 'no', admin)).rejects.toThrow('Only finished sessions');
  });
});

describe('deleting a session', () => {
  it('cancels session + invoice, keeps it as Deleted, removes it from revenue', async () => {
    const s = await finished();
    const today = businessDate();
    const before = (await reportService.report(today, today, 'day')).summary.revenue;
    const del = await sessionService.remove(s.id, 'Entered by mistake', admin);
    expect(del.status).toBe('CANCELLED');
    expect(del.deleted_at).toBeTruthy();
    expect(del.delete_reason).toBe('Entered by mistake');
    expect((await invoiceService.get(s.invoice_id!)).payment_status).toBe('CANCELLED');
    expect((await reportService.report(today, today, 'day')).summary.revenue).toBeCloseTo(before - 140, 2);
    expect((await sessionService.changes(s.id)).at(-1)).toMatchObject({ action: 'DELETE', old_amount: 140, new_amount: 0 });
    await expect(sessionService.remove(s.id, 'again', admin)).rejects.toThrow('already deleted');
  });

  it('frees the console when deleting a session that is playing', async () => {
    const c = await createConsole('PS5');
    const s = await sessionService.create({ customer_id: customer.id, console_id: c.id, start: minutesFromNow(-5), end: minutesFromNow(55) }, admin);
    await sessionService.remove(s.id, 'Wrong console booked', admin);
    const { rows } = await pool.query('SELECT status FROM consoles WHERE id = $1', [c.id]);
    expect(rows[0].status).toBe('AVAILABLE');
  });

  it('gives back membership hours', async () => {
    const plan = await membershipService.createPlan({ name: `Del ${Date.now()}`, price: 799, minutes: 360, console_type: null, validity_days: 30 });
    const { membership } = await membershipService.sell(customer.id, plan.id, admin);
    const c = await createConsole('PS5');
    const s = await sessionService.create({ customer_id: customer.id, console_id: c.id, start: minutesFromNow(-120), end: minutesFromNow(-60), membership_id: membership.id }, admin);
    expect((await membershipService.get(membership.id)).minutes_left).toBe(300);
    await sessionService.remove(s.id, 'Duplicate entry', admin);
    expect((await membershipService.get(membership.id)).minutes_left).toBe(360);
  });

  it('refuses to delete a session that has payments', async () => {
    const s = await finished();
    await paymentService.record({ invoice_id: s.invoice_id!, amount: 140, payment_method: 'UPI' }, admin);
    await expect(sessionService.remove(s.id, 'oops', admin)).rejects.toThrow("can't be deleted");
  });
});

describe('corrections API', () => {
  const app = createApp();
  let adminToken: string;
  let staffToken: string;
  const login = async (email: string) => (await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!' })).body.data.token;
  beforeAll(async () => {
    adminToken = await login(admin.email);
    staffToken = await login((await createUser('STAFF')).email);
  });

  it('is admin-only and requires a reason', async () => {
    const s = await finished();
    const asStaff = await request(app).put(`/api/sessions/${s.id}/amount`).set({ Authorization: `Bearer ${staffToken}` }).send({ amount: 100, reason: 'x y z' });
    expect(asStaff.status).toBe(403);
    const noReason = await request(app).put(`/api/sessions/${s.id}/amount`).set({ Authorization: `Bearer ${adminToken}` }).send({ amount: 100 });
    expect(noReason.status).toBe(400);
    const ok = await request(app).put(`/api/sessions/${s.id}/amount`).set({ Authorization: `Bearer ${adminToken}` }).send({ amount: 120, reason: 'Corrected' });
    expect(ok.status).toBe(200);
    const del = await request(app).delete(`/api/sessions/${s.id}`).set({ Authorization: `Bearer ${adminToken}` }).send({ reason: 'Test entry' });
    expect(del.status).toBe(200);
    const changes = await request(app).get(`/api/sessions/${s.id}/changes`).set({ Authorization: `Bearer ${staffToken}` });
    expect(changes.body.data.map((c: { action: string }) => c.action)).toEqual(['EDIT', 'DELETE']);
  });
});

describe('editing a session duration', () => {
  it('recalculates the amount from the new duration and records it', async () => {
    const s = await finished(); // 60 min × ₹140
    const edited = await sessionService.editAmount(s.id, { durationMinutes: 45 }, 'Customer left early, timer not stopped', admin);
    expect(edited.duration_minutes).toBe(45);
    expect(edited.final_amount).toBe(105);
    expect(new Date(edited.actual_end_datetime!).getTime() - new Date(edited.start_datetime).getTime()).toBe(45 * 60_000);
    expect((await invoiceService.get(s.invoice_id!)).total).toBe(105);
    const last = (await sessionService.changes(s.id)).at(-1)!;
    expect(last).toMatchObject({ action: 'EDIT', old_amount: 140, new_amount: 105, old_duration: 60, new_duration: 45 });
  });

  it('prices groups per player and allows an amount override with a duration change', async () => {
    const c = await createConsole('PS5');
    const s = await sessionService.create({ customer_id: customer.id, console_id: c.id, start: minutesFromNow(-120), end: minutesFromNow(-60), players: 3 }, admin);
    expect((await sessionService.priceFor(s.id, 30)).amount).toBe(210); // 30 min × 3 × ₹140/hr
    const edited = await sessionService.editAmount(s.id, { durationMinutes: 30, amount: 200 }, 'Rounded down', admin);
    expect(edited.duration_minutes).toBe(30);
    expect(edited.final_amount).toBe(200);
  });

  it('adjusts membership hours when the duration changes', async () => {
    const plan = await membershipService.createPlan({ name: `Dur ${Date.now()}`, price: 799, minutes: 360, console_type: null, validity_days: 30 });
    const { membership } = await membershipService.sell(customer.id, plan.id, admin);
    const c = await createConsole('PS5');
    const s = await sessionService.create({ customer_id: customer.id, console_id: c.id, start: minutesFromNow(-120), end: minutesFromNow(-60), membership_id: membership.id }, admin);
    expect((await membershipService.get(membership.id)).minutes_left).toBe(300);
    await sessionService.editAmount(s.id, { durationMinutes: 30 }, 'Played only 30 min', admin);
    expect((await membershipService.get(membership.id)).minutes_left).toBe(330);
  });

  it('rejects an edit that changes nothing', async () => {
    const s = await finished();
    await expect(sessionService.editAmount(s.id, { durationMinutes: 60 }, 'same', admin)).rejects.toThrow('Nothing changed');
  });
});
