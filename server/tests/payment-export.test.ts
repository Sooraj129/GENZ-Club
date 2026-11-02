import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { pool } from '../src/config/db.js';
import { paymentService } from '../src/services/paymentService.js';
import { sessionService } from '../src/services/sessionService.js';
import type { AuthUser } from '../src/types/index.js';
import { addDays, businessDate } from '../src/utils/time.js';
import { createConsole, createCustomer, createUser, minutesFromNow } from './helpers.js';

const app = createApp();
let staff: AuthUser;
let token: string;

beforeAll(async () => {
  staff = await createUser('STAFF');
  token = (await request(app).post('/api/auth/login').send({ email: staff.email, password: 'Passw0rd!' })).body.data.token;
});

/** A paid 1-hour PS5 session (₹140) by `method`. */
async function paid(method: 'CASH' | 'UPI' | 'CARD') {
  const cust = await createCustomer('Excel Cust');
  const c = await createConsole('PS5');
  const s = await sessionService.create({ customer_id: cust.id, console_id: c.id, start: minutesFromNow(-120), end: minutesFromNow(-60) }, staff);
  return (await paymentService.record({ invoice_id: s.invoice_id!, amount: 140, payment_method: method }, staff)).payment;
}

describe('payments Excel export', () => {
  it('has a Summary sheet and one sheet per date with correct totals', async () => {
    const today = businessDate();
    const yesterday = addDays(today, -1);
    const a = await paid('CASH');
    await paid('UPI');
    const old = await paid('CARD');
    // move one payment to yesterday
    await pool.query(`UPDATE payments SET paid_at = paid_at - interval '1 day' WHERE id = $1`, [old.id]);

    const res = await request(app)
      .get(`/api/payments/export?from=${yesterday}&to=${today}`)
      .set({ Authorization: `Bearer ${token}` })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain(`payments_${yesterday}_to_${today}.xlsx`);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', dmy(yesterday), dmy(today)]);

    // today's sheet lists at least our two payments, and its total row matches its rows
    const sheet = wb.getWorksheet(dmy(today))!;
    const rows = sheet.getSheetValues().filter(Boolean) as unknown[][];
    const dataRows = rows.slice(2, -1); // skip title + header, drop total
    const sum = dataRows.reduce((s, r) => s + Number(r[8] ?? 0), 0);
    expect(dataRows.length).toBeGreaterThanOrEqual(2);
    expect(Number(rows.at(-1)![8])).toBeCloseTo(sum, 2);
    // header includes Phone, and every payment row has a 10-digit phone
    expect(rows[1]).toContain('Phone');
    for (const r of dataRows) expect(String(r[4])).toMatch(/^[6-9]\d{9}$/);
    expect(a.amount).toBe(140);

    // Summary grand total = sum of both days
    const summaryRows = wb.getWorksheet('Summary')!.getSheetValues().filter(Boolean) as unknown[][];
    const total = summaryRows.at(-1)!;
    expect(total[1]).toBe('Total');
    const dayTotals = summaryRows.slice(2, -1).reduce((s, r) => s + Number(r[6] ?? 0), 0);
    expect(Number(total[6])).toBeCloseTo(dayTotals, 2);
  });

  it('defaults to today and rejects a reversed range', async () => {
    const ok = await request(app).get('/api/payments/export').set({ Authorization: `Bearer ${token}` });
    expect(ok.status).toBe(200);
    expect(ok.headers['content-disposition']).toContain(`payments_${businessDate()}.xlsx`);
    const bad = await request(app).get('/api/payments/export?from=2026-12-02&to=2026-12-01').set({ Authorization: `Bearer ${token}` });
    expect(bad.status).toBe(400);
  });
});
