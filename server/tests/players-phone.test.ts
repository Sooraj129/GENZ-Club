import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { BillingService } from '../src/services/billingService.js';
import { customerService } from '../src/services/customerService.js';
import { invoiceService } from '../src/services/invoiceService.js';
import { membershipService } from '../src/services/membershipService.js';
import { sessionService } from '../src/services/sessionService.js';
import type { AuthUser } from '../src/types/index.js';
import { createConsole, createCustomer, createUser, minutesFromNow } from './helpers.js';

let staff: AuthUser;
let customer: { id: string };

beforeAll(async () => {
  staff = await createUser('STAFF');
  customer = await createCustomer('Squad');
});

const book = (consoleId: string, startMin: number, endMin: number, players = 1, membershipId?: string) =>
  sessionService.create(
    { customer_id: customer.id, console_id: consoleId, start: minutesFromNow(startMin), end: minutesFromNow(endMin), players, membership_id: membershipId },
    staff,
  );

describe('group play (players per console)', () => {
  it('charges every player the hourly rate', () => {
    expect(BillingService.sessionCharge(60, 140, 3).amount).toBe(420);
    expect(BillingService.sessionCharge(30, 120, 5).amount).toBe(300);
    // rounded once on the total, not per player: 20 min × 3 × ₹140/hr = exactly ₹140
    expect(BillingService.sessionCharge(20, 140, 3).amount).toBe(140);
    expect(BillingService.sessionCharge(1, 140, 3).amount).toBe(7);
    // membership covers the owner's 60 min; the other two pay
    expect(BillingService.sessionCharge(60, 140, 3, 60)).toEqual({ covered: 60, amount: 280 });
  });

  it('books and bills a group on PS5', async () => {
    const c = await createConsole('PS5');
    const s = await book(c.id, -120, -60, 3); // 60 min, 3 players, already over → invoiced
    expect(s.players).toBe(3);
    expect(s.final_amount).toBe(420);
    const inv = await invoiceService.get(s.invoice_id!);
    expect(inv.players).toBe(3);
    expect(inv.total).toBe(420);
  });

  it('estimates and extends per player', async () => {
    const c = await createConsole('PS4');
    const s = await book(c.id, 60, 120, 2); // 2 × ₹120
    expect(s.estimated_amount).toBe(240);
    const ext = await sessionService.extend(s.id, 30); // 90 min × 2 × ₹120/hr
    expect(ext.estimated_amount).toBe(360);
  });

  it('allows at most 5 players on PS5/PS4 and 1 on Steering Wheel / VR', async () => {
    const ps5 = await createConsole('PS5');
    await expect(book(ps5.id, 60, 120, 6)).rejects.toThrow('at most 5 players');
    const vr = await createConsole('VR');
    await expect(book(vr.id, 60, 120, 2)).rejects.toThrow('single-player');
    await expect(book(vr.id, 60, 120, 1)).resolves.toBeTruthy();
  });

  it('membership covers only its owner in a group', async () => {
    const plan = await membershipService.createPlan({ name: `Grp ${Date.now()}`, price: 799, minutes: 360, console_type: null, validity_days: 30 });
    const { membership } = await membershipService.sell(customer.id, plan.id, staff);
    const c = await createConsole('PS5');
    const s = await book(c.id, -120, -60, 2, membership.id); // owner free, friend pays ₹140
    expect(s.membership_minutes).toBe(60);
    expect(s.final_amount).toBe(140);
  });

  it('accepts a 10-minute session', async () => {
    const c = await createConsole('PS5');
    const s = await book(c.id, 60, 70);
    expect(s.booked_minutes).toBe(10);
    expect(s.estimated_amount).toBeCloseTo(23.33, 2);
  });
});

describe('default phone for walk-in customers', () => {
  const app = createApp();
  let token: string;
  beforeAll(async () => {
    const u = await createUser('STAFF');
    token = (await request(app).post('/api/auth/login').send({ email: u.email, password: 'Passw0rd!' })).body.data.token;
  });

  it('several customers without a phone all get 6381897882', async () => {
    const a = await request(app).post('/api/customers').set({ Authorization: `Bearer ${token}` }).send({ name: 'Walk-in A', phone: '' });
    const b = await request(app).post('/api/customers').set({ Authorization: `Bearer ${token}` }).send({ name: 'Walk-in B' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.phone).toBe('6381897882');
    expect(b.body.data.phone).toBe('6381897882');
  });

  it('a real phone number is still unique', async () => {
    await customerService.create({ name: 'Real', phone: '9123456780', email: null });
    await expect(customerService.create({ name: 'Copy', phone: '9123456780', email: null })).rejects.toThrow('Customer already exists');
  });

  it('invoices always show the shop number, never the customer phone', async () => {
    const c = await createConsole('PS5');
    const s = await book(c.id, -60, -30);
    const inv = await invoiceService.get(s.invoice_id!);
    expect(inv.invoice_phone).toBe('6381897882');
  });
});
