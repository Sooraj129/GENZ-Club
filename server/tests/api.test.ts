import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createConsole, createUser } from './helpers.js';

const app = createApp();
let adminToken: string;
let staffToken: string;

async function login(email: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!' });
  return res.body.data.token as string;
}

beforeAll(async () => {
  adminToken = await login((await createUser('ADMIN')).email);
  staffToken = await login((await createUser('STAFF')).email);
});

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('authentication & authorization', () => {
  it('rejects bad credentials with a generic message', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@test.local', password: 'x' });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, message: 'Invalid email or password' });
    // Every error carries the request ID that also appears in the server log.
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('requires a token for protected routes', async () => {
    expect((await request(app).get('/api/customers')).status).toBe(401);
    expect((await request(app).get('/api/customers').set({ Authorization: 'Bearer garbage' })).status).toBe(401);
  });

  it('returns the current user', async () => {
    const res = await request(app).get('/api/auth/me').set(as(staffToken));
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('STAFF');
    expect(res.body.data.user).not.toHaveProperty('password_hash');
  });

  it('restricts admin-only endpoints', async () => {
    expect((await request(app).get('/api/users').set(as(staffToken))).status).toBe(403);
    expect((await request(app).put('/api/pricing').set(as(staffToken)).send({ prices: [{ console_type: 'PS5', hourly_rate: 150 }] })).status).toBe(403);
    expect((await request(app).get('/api/users').set(as(adminToken))).status).toBe(200);
  });
});

describe('customers API', () => {
  it('normalises phone numbers and reports duplicates with the existing customer', async () => {
    const created = await request(app).post('/api/customers').set(as(staffToken)).send({ name: 'John', phone: '+91 98111 22233', email: 'john@gmail.com' });
    expect(created.status).toBe(201);
    expect(created.body.data.phone).toBe('9811122233');

    const dup = await request(app).post('/api/customers').set(as(staffToken)).send({ name: 'Johnny', phone: '9811122233' });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe('Customer already exists');
    expect(dup.body.data.customer.name).toBe('John');
  });

  it('searches by phone and by name', async () => {
    const byPhone = await request(app).get('/api/customers/search?q=98111').set(as(staffToken));
    expect(byPhone.body.data[0].name).toBe('John');
    const byName = await request(app).get('/api/customers/search?q=joh').set(as(staffToken));
    expect(byName.body.data.some((c: { phone: string }) => c.phone === '9811122233')).toBe(true);
  });

  it('validates input with consistent error responses', async () => {
    const res = await request(app).post('/api/customers').set(as(staffToken)).send({ name: '', phone: '123' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.message).toBe('string');
  });
});

describe('sessions API', () => {
  it('quotes and books using IST wall-clock times, rejecting overlaps', async () => {
    const c = await createConsole('PS5');
    const customer = await request(app).post('/api/customers').set(as(staffToken)).send({ name: 'Kumar', phone: '9822233344' });
    const slot = { start_date: '2030-01-15', start_time: '18:00', end_date: '2030-01-15', end_time: '20:00' };

    const quote = await request(app).post('/api/sessions/quote').set(as(staffToken)).send({ console_id: c.id, ...slot });
    expect(quote.body.data).toMatchObject({ duration_minutes: 120, hourly_rate: 140, estimated_amount: 280, available: true });

    const booked = await request(app).post('/api/sessions').set(as(staffToken)).send({ customer_id: customer.body.data.id, console_id: c.id, ...slot });
    expect(booked.status).toBe(201);
    expect(booked.body.data.start_datetime).toBe('2030-01-15T12:30:00.000Z'); // 18:00 IST

    const clash = await request(app)
      .post('/api/sessions')
      .set(as(staffToken))
      .send({ customer_id: customer.body.data.id, console_id: c.id, ...slot, start_time: '19:00', end_time: '21:00' });
    expect(clash.status).toBe(409);
    expect(clash.body).toMatchObject({ success: false, message: `${c.console_number} is already booked during the selected time.` });
  });

  it('echoes a client-supplied request ID for tracing', async () => {
    const res = await request(app).get('/api/consoles').set(as(staffToken)).set('X-Request-Id', 'trace-abc-12345');
    expect(res.headers['x-request-id']).toBe('trace-abc-12345');
  });

  it('only lets admins delete consoles, and never one with session history', async () => {
    const unused = await createConsole('PS4');
    expect((await request(app).delete(`/api/consoles/${unused.id}`).set(as(staffToken))).status).toBe(403);
    expect((await request(app).delete(`/api/consoles/${unused.id}`).set(as(adminToken))).status).toBe(200);

    const used = await createConsole('PS5');
    const cust = await request(app).post('/api/customers').set(as(staffToken)).send({ name: 'Del Test', phone: '9833344455' });
    await request(app)
      .post('/api/sessions')
      .set(as(staffToken))
      .send({ customer_id: cust.body.data.id, console_id: used.id, start_date: '2030-02-01', start_time: '10:00', end_date: '2030-02-01', end_time: '11:00' });
    const res = await request(app).delete(`/api/consoles/${used.id}`).set(as(adminToken));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Disabled/);
  });

  it('never leaks internals on unexpected errors', async () => {
    const res = await request(app).get('/api/sessions/not-a-uuid').set(as(staffToken));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|postgres|SELECT/i);
  });
});
