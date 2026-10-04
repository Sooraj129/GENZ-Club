/**
 * Seeds demo data. Safe to re-run: reference data is upserted, and sample
 * sessions/invoices are only generated when the sessions table is empty.
 *
 *   npm run seed              # demo users, customers, consoles, history
 *   npm run seed -- --reset   # DELETES all customers, consoles, sessions, invoices
 *                             # and payments first, then seeds fresh demo data.
 *                             # Users, pricing and settings are kept.
 *   npm run seed -- --minimal # only the admin/staff logins and the consoles —
 *                             # no demo customers, sessions or invoices.
 */
import { pool, withTransaction } from '../src/config/db.js';
import { authService } from '../src/services/authService.js';
import { BillingService } from '../src/services/billingService.js';
import { formatInvoiceNumber } from '../src/services/invoiceService.js';
import { addDays, businessDate, businessDateTimeToDate, now } from '../src/utils/time.js';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@gamecenter.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@1234';
const STAFF_EMAIL = process.env.SEED_STAFF_EMAIL ?? 'staff@gamecenter.local';
const STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD ?? 'Staff@1234';

const CUSTOMERS = [
  { name: 'John', phone: '9876543210', email: 'john@gmail.com' },
  { name: 'Arun', phone: '9876543211', email: null },
  { name: 'Kumar', phone: '9876543212', email: null },
  { name: 'Priya', phone: '9876543213', email: 'priya@example.com' },
  { name: 'Rahul', phone: '9876543214', email: null },
  { name: 'Vikram', phone: '9876543215', email: 'vikram@example.com' },
];

/** The center's actual hardware: 3 × PS5, 1 × PS4. */
const CONSOLES = [
  { number: 'PS5-01', type: 'PS5' },
  { number: 'PS5-02', type: 'PS5' },
  { number: 'PS5-03', type: 'PS5' },
  { number: 'PS4-01', type: 'PS4' },
];

const RESET = process.argv.includes('--reset');
const MINIMAL = process.argv.includes('--minimal');

/** Removes all business data (children before parents). Users, pricing and settings stay. */
async function resetBusinessData() {
  await withTransaction(async (db) => {
    await db.query('DELETE FROM payments');
    await db.query('DELETE FROM invoices');
    await db.query('DELETE FROM invoice_counters');
    await db.query('DELETE FROM sessions');
    await db.query('DELETE FROM consoles');
    await db.query('DELETE FROM customers');
  });
  console.log('Reset: removed customers, consoles, sessions, invoices and payments.');
}

/** Deterministic PRNG so every seed produces the same demo history. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

async function main() {
  const adminHash = await authService.hashPassword(ADMIN_PASSWORD);
  const staffHash = await authService.hashPassword(STAFF_PASSWORD);
  if (RESET) await resetBusinessData();

  await withTransaction(async (db) => {
    for (const [name, email, hash, role] of [
      ['Admin', ADMIN_EMAIL, adminHash, 'ADMIN'],
      ['Front Desk', STAFF_EMAIL, staffHash, 'STAFF'],
    ]) {
      await db.query(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
         ON CONFLICT (lower(email)) DO NOTHING`,
        [name, email, hash, role],
      );
    }
    for (const c of MINIMAL ? [] : CUSTOMERS) {
      await db.query(
        `INSERT INTO customers (name, phone, email) VALUES ($1, $2, $3) ON CONFLICT (phone) DO NOTHING`,
        [c.name, c.phone, c.email],
      );
    }
    await db.query(
      `INSERT INTO pricing (console_type, hourly_rate) VALUES ('PS4', 120), ('PS5', 140)
       ON CONFLICT (console_type) DO NOTHING`,
    );
    for (const c of CONSOLES) {
      await db.query(
        `INSERT INTO consoles (console_number, console_type) VALUES ($1, $2) ON CONFLICT (console_number) DO NOTHING`,
        [c.number, c.type],
      );
    }
  });
  console.log('Reference data ready.');
  if (MINIMAL) {
    console.log('Minimal seed: no demo customers or history created.');
    return;
  }

  const { rows: existing } = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM sessions');
  if (existing[0].count > 0) {
    console.log('Sessions already exist — skipping sample history.');
    return;
  }

  await withTransaction(async (db) => {
    const { rows: users } = await db.query<{ id: string; email: string }>('SELECT id, email FROM users');
    const staffId = users.find((u) => u.email === STAFF_EMAIL)?.id ?? users[0].id;
    const { rows: customers } = await db.query<{ id: string }>('SELECT id FROM customers ORDER BY phone');
    const { rows: consoles } = await db.query<{ id: string; console_number: string; rate: number }>(
      `SELECT c.id, c.console_number, COALESCE(c.hourly_rate, p.hourly_rate) AS rate
       FROM consoles c JOIN pricing p USING (console_type)
       WHERE c.status <> 'MAINTENANCE' ORDER BY c.console_number`,
    );

    const rand = rng(42);
    const today = businessDate(now());
    const methods = ['CASH', 'UPI', 'UPI', 'CARD'] as const;
    let sessionCount = 0;

    // ---- 14 days of finished sessions with invoices and payments
    for (let dayOffset = 14; dayOffset >= 1; dayOffset--) {
      const day = addDays(today, -dayOffset);
      let seq = 0;
      for (const c of consoles) {
        let cursor = (11 + Math.floor(rand() * 3)) * 60; // minutes since midnight; first booking 11:00–13:00
        while (cursor < 21 * 60 && rand() > 0.25) {
          const minutes = [30, 60, 60, 90, 120, 120, 180][Math.floor(rand() * 7)];
          const hh = String(Math.floor(cursor / 60)).padStart(2, '0');
          const mm = String(cursor % 60).padStart(2, '0');
          const start = businessDateTimeToDate(day, `${hh}:${mm}`);
          const end = new Date(start.getTime() + minutes * 60_000);
          // ~20% leave early
          const leftEarly = rand() < 0.2;
          const actualEnd = leftEarly ? new Date(start.getTime() + Math.floor(minutes * 0.6) * 60_000) : end;
          const charge = BillingService.finalCharge(start, end, actualEnd, c.rate);
          const estimate = BillingService.estimate(start, end, c.rate).amount;
          const customer = customers[Math.floor(rand() * customers.length)];

          const { rows } = await db.query<{ id: string }>(
            `INSERT INTO sessions (customer_id, console_id, start_datetime, segment_start_datetime, end_datetime, booked_minutes,
               played_minutes, actual_end_datetime, duration_minutes, hourly_rate, estimated_amount, final_amount, status,
               created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $3, $4, $5, 0, $6, $7, $8, $9, $10, $11, $12, $3, $6) RETURNING id`,
            [customer.id, c.id, start, end, minutes, charge.actualEnd, charge.durationMinutes, c.rate, estimate,
             charge.amount, leftEarly ? 'COMPLETED' : 'EXPIRED', staffId],
          );
          seq++;
          const totals = BillingService.invoiceTotals(charge.amount, 0, 0);
          // Older invoices are all settled; the last couple of days have some outstanding.
          const unpaid = dayOffset <= 2 && rand() < 0.3;
          const partial = !unpaid && dayOffset <= 2 && rand() < 0.15;
          const paid = unpaid ? 0 : partial ? Math.round(totals.total / 2) : totals.total;
          const { rows: inv } = await db.query<{ id: string }>(
            `INSERT INTO invoices (invoice_number, session_id, customer_id, subtotal, discount, tax, total, payment_status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
            [formatInvoiceNumber(day, seq), rows[0].id, customer.id, totals.subtotal, totals.discount, totals.tax,
             totals.total, BillingService.paymentStatus(totals.total, paid), charge.actualEnd],
          );
          if (paid > 0) {
            await db.query(
              `INSERT INTO payments (invoice_id, amount, payment_method, paid_at, processed_by, created_at)
               VALUES ($1, $2, $3, $4, $5, $4)`,
              [inv[0].id, paid, methods[Math.floor(rand() * methods.length)], new Date(charge.actualEnd.getTime() + 2 * 60_000), staffId],
            );
          }
          sessionCount++;
          cursor += minutes + (rand() > 0.6 ? 30 : 0); // next booking starts after this one's slot
        }
      }
      await db.query(
        `INSERT INTO invoice_counters (business_date, last_value) VALUES ($1, $2)
         ON CONFLICT (business_date) DO UPDATE SET last_value = GREATEST(invoice_counters.last_value, EXCLUDED.last_value)`,
        [day, seq],
      );
    }

    // ---- Live data for today: two sessions in progress and one upcoming booking
    const at = now();
    const minute = 60_000;
    const live = [
      { console: consoles[0], customer: customers[0], start: new Date(at.getTime() - 35 * minute), minutes: 60, status: 'ACTIVE' },
      { console: consoles[3], customer: customers[1], start: new Date(at.getTime() - 50 * minute), minutes: 120, status: 'ACTIVE' },
      { console: consoles[1], customer: customers[2], start: new Date(at.getTime() + 10 * minute), minutes: 60, status: 'SCHEDULED' },
    ];
    for (const s of live) {
      // Round to whole minutes so times read cleanly.
      const start = new Date(Math.round(s.start.getTime() / minute) * minute);
      const end = new Date(start.getTime() + s.minutes * minute);
      await db.query(
        `INSERT INTO sessions (customer_id, console_id, start_datetime, segment_start_datetime, end_datetime, booked_minutes,
                               hourly_rate, estimated_amount, status, created_by)
         VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9)`,
        [s.customer.id, s.console.id, start, end, s.minutes, s.console.rate,
         BillingService.estimate(start, end, s.console.rate).amount, s.status, staffId],
      );
      sessionCount++;
    }
    await db.query(`UPDATE consoles SET status = 'PLAYING' WHERE id IN ($1, $2)`, [consoles[0].id, consoles[3].id]);
    await db.query(`UPDATE consoles SET status = 'RESERVED' WHERE id = $1`, [consoles[1].id]);
    console.log(`Created ${sessionCount} sample sessions with invoices and payments.`);
  });
}

main()
  .then(() => {
    console.log('\nDemo logins:');
    console.log(`  Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
    console.log(`  Staff: ${STAFF_EMAIL} / ${STAFF_PASSWORD}`);
    console.log('Change these passwords from the Users page before going live.');
  })
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
