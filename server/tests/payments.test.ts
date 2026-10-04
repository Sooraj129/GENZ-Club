import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/config/db.js';
import { invoiceService } from '../src/services/invoiceService.js';
import { paymentService } from '../src/services/paymentService.js';
import { sessionService } from '../src/services/sessionService.js';
import type { AuthUser } from '../src/types/index.js';
import { count, createConsole, createCustomer, createUser, minutesFromNow } from './helpers.js';

let staff: AuthUser;
let customer: { id: string };

beforeAll(async () => {
  staff = await createUser('STAFF');
  customer = await createCustomer('Arun');
});

/** A finished 2-hour PS5 session → ₹280 invoice. */
async function finishedInvoice() {
  const c = await createConsole('PS5');
  const s = await sessionService.create(
    { customer_id: customer.id, console_id: c.id, start: minutesFromNow(-180), end: minutesFromNow(-60) },
    staff,
  );
  return invoiceService.get(s.invoice_id!);
}

describe('invoice generation', () => {
  it('generates an invoice with the correct amount and number format', async () => {
    const inv = await finishedInvoice();
    expect(inv.subtotal).toBe(280);
    expect(inv.discount).toBe(0);
    expect(inv.tax).toBe(0);
    expect(inv.total).toBe(280);
    expect(inv.payment_status).toBe('PENDING');
    expect(inv.invoice_number).toMatch(/^GC-\d{8}-\d{4}$/);
  });

  it('numbers invoices sequentially per day', async () => {
    const a = await finishedInvoice();
    const b = await finishedInvoice();
    const seq = (n: string) => Number(n.slice(-4));
    expect(b.invoice_number.slice(0, 11)).toBe(a.invoice_number.slice(0, 11));
    expect(seq(b.invoice_number)).toBe(seq(a.invoice_number) + 1);
  });

  it('never creates a second invoice for the same session', async () => {
    const inv = await finishedInvoice();
    const { rows } = await pool.query('SELECT * FROM sessions WHERE id = $1', [inv.session_id]);
    const client = await pool.connect();
    try {
      const again = await invoiceService.createForSession(rows[0], client);
      expect(again.created).toBe(false);
      expect(again.invoice.id).toBe(inv.id);
    } finally {
      client.release();
    }
    expect(await count('SELECT 1 FROM invoices WHERE session_id = $1', [inv.session_id])).toBe(1);
  });

  it('applies a discount before payment', async () => {
    const inv = await finishedInvoice();
    const updated = await invoiceService.applyDiscount(inv.id, 30);
    expect(updated.total).toBe(250);
  });
});

describe('payments', () => {
  it.each(['CASH', 'UPI', 'CARD'] as const)('accepts full payment by %s', async (method) => {
    const inv = await finishedInvoice();
    const r = await paymentService.record({ invoice_id: inv.id, amount: 280, payment_method: method }, staff);
    expect(r.payment.payment_method).toBe(method);
    expect(r.invoice.payment_status).toBe('PAID');
    expect(r.invoice.balance_due).toBe(0);
  });

  it('tracks partial payments until the balance is cleared', async () => {
    const inv = await finishedInvoice();
    const first = await paymentService.record({ invoice_id: inv.id, amount: 100, payment_method: 'CASH' }, staff);
    expect(first.invoice.payment_status).toBe('PARTIALLY_PAID');
    expect(first.invoice.balance_due).toBe(180);
    const second = await paymentService.record({ invoice_id: inv.id, amount: 180, payment_method: 'UPI' }, staff);
    expect(second.invoice.payment_status).toBe('PAID');
  });

  it('rejects payment on an invoice that is already paid', async () => {
    const inv = await finishedInvoice();
    await paymentService.record({ invoice_id: inv.id, amount: 280, payment_method: 'CASH' }, staff);
    await expect(
      paymentService.record({ invoice_id: inv.id, amount: 280, payment_method: 'CASH' }, staff),
    ).rejects.toThrow('already fully paid');
  });

  it('rejects an amount greater than the balance due', async () => {
    const inv = await finishedInvoice();
    await expect(
      paymentService.record({ invoice_id: inv.id, amount: 281, payment_method: 'CARD' }, staff),
    ).rejects.toThrow('exceeds the balance');
  });

  it('treats a retried request with the same idempotency key as one payment', async () => {
    const inv = await finishedInvoice();
    const input = { invoice_id: inv.id, amount: 280, payment_method: 'UPI' as const, idempotency_key: `key-${inv.id}` };
    const [a, b] = await Promise.all([paymentService.record(input, staff), paymentService.record(input, staff)]);
    expect(a.payment.id).toBe(b.payment.id);
    expect(await count('SELECT 1 FROM payments WHERE invoice_id = $1', [inv.id])).toBe(1);
  });

  it('lets only one of two simultaneous full payments succeed', async () => {
    const inv = await finishedInvoice();
    const results = await Promise.allSettled([
      paymentService.record({ invoice_id: inv.id, amount: 280, payment_method: 'CASH' }, staff),
      paymentService.record({ invoice_id: inv.id, amount: 280, payment_method: 'CARD' }, staff),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const { rows } = await pool.query('SELECT COALESCE(sum(amount),0)::float AS paid FROM payments WHERE invoice_id = $1', [inv.id]);
    expect(rows[0].paid).toBe(280);
  });

  it('blocks discounts once money has been collected', async () => {
    const inv = await finishedInvoice();
    await paymentService.record({ invoice_id: inv.id, amount: 50, payment_method: 'CASH' }, staff);
    await expect(invoiceService.applyDiscount(inv.id, 20)).rejects.toThrow('before any payment');
  });
});
