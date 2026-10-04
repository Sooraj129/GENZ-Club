import { withTransaction, type Queryable } from '../config/db.js';
import { invoiceRepository, type InvoiceFilters } from '../repositories/invoiceRepository.js';
import { membershipRepository } from '../repositories/membershipRepository.js';
import { paymentRepository } from '../repositories/paymentRepository.js';
import { emitEvent } from '../sockets/index.js';
import type { Invoice, Membership, Session } from '../types/index.js';
import { badRequest, notFound } from '../utils/errors.js';
import { businessDate, now } from '../utils/time.js';
import { BillingService } from './billingService.js';
import { settingsService } from './settingsService.js';

export function formatInvoiceNumber(date: string, sequence: number): string {
  return `GC-${date.replaceAll('-', '')}-${String(sequence).padStart(4, '0')}`;
}

export const invoiceService = {
  /**
   * Generates the invoice for a finished session. Must be called inside the
   * transaction that holds the session's row lock. Idempotent: if the session
   * already has an invoice, that invoice is returned and nothing is created
   * (the UNIQUE(session_id) constraint backs this up at the database level).
   */
  async createForSession(session: Session, db: Queryable): Promise<{ invoice: Invoice; created: boolean }> {
    const existing = await invoiceRepository.findBySession(session.id, db);
    if (existing) return { invoice: existing, created: false };
    if (session.final_amount === null) throw new Error(`Session ${session.id} has no final amount`);

    const { tax_percent } = await settingsService.get(db);
    const totals = BillingService.invoiceTotals(session.final_amount, 0, tax_percent);
    const day = businessDate(now());
    const sequence = await invoiceRepository.nextSequence(day, db);

    const invoice = await invoiceRepository.insertIfAbsent(
      {
        invoice_number: formatInvoiceNumber(day, sequence),
        session_id: session.id,
        customer_id: session.customer_id,
        ...totals,
        payment_status: BillingService.paymentStatus(totals.total, 0),
      },
      db,
    );
    if (invoice) return { invoice, created: true };
    return { invoice: (await invoiceRepository.findBySession(session.id, db))!, created: false };
  },

  /** Invoice for selling a membership package. Called inside the sale's transaction. */
  async createForMembership(membership: Membership, db: Queryable): Promise<Invoice> {
    const { tax_percent } = await settingsService.get(db);
    const totals = BillingService.invoiceTotals(membership.price, 0, tax_percent);
    const day = businessDate(now());
    const sequence = await invoiceRepository.nextSequence(day, db);
    return invoiceRepository.insertForMembership(
      {
        invoice_number: formatInvoiceNumber(day, sequence),
        membership_id: membership.id,
        customer_id: membership.customer_id,
        ...totals,
        payment_status: BillingService.paymentStatus(totals.total, 0),
      },
      db,
    );
  },

  list(filters: InvoiceFilters, page: number, pageSize: number) {
    return invoiceRepository.list(filters, pageSize, (page - 1) * pageSize);
  },

  async get(id: string) {
    const invoice = await invoiceRepository.findView(id);
    if (!invoice) throw notFound('Invoice not found');
    const payments = await paymentRepository.listForInvoice(id);
    return {
      ...invoice,
      balance_due: BillingService.balance(invoice.total, invoice.amount_paid),
      payments,
    };
  },

  /** Admin-only: apply a discount before any money has been collected. */
  async applyDiscount(id: string, discount: number) {
    await withTransaction(async (client) => {
      const invoice = await invoiceRepository.lockById(id, client);
      if (!invoice) throw notFound('Invoice not found');
      if (invoice.payment_status === 'CANCELLED') throw badRequest('Invoice is cancelled');
      if ((await paymentRepository.sumForInvoice(id, client)) > 0) {
        throw badRequest('Discounts can only be applied before any payment is recorded');
      }
      if (discount > invoice.subtotal) throw badRequest('Discount cannot exceed the subtotal');

      // Keep the tax rate the invoice was issued with.
      const taxable = invoice.subtotal - invoice.discount;
      const taxPercent = taxable > 0 ? (invoice.tax / taxable) * 100 : (await settingsService.get(client)).tax_percent;
      const totals = BillingService.invoiceTotals(invoice.subtotal, discount, taxPercent);
      await invoiceRepository.update(
        id,
        { discount: totals.discount, tax: totals.tax, total: totals.total, payment_status: BillingService.paymentStatus(totals.total, 0) },
        client,
      );
    });
    emitEvent('invoice:updated', { invoice_id: id });
    emitEvent('dashboard:updated');
    return this.get(id);
  },

  /** Admin-only: void an invoice that has no payments against it. */
  async cancel(id: string) {
    await withTransaction(async (client) => {
      const invoice = await invoiceRepository.lockById(id, client);
      if (!invoice) throw notFound('Invoice not found');
      if (invoice.payment_status === 'CANCELLED') return;
      if ((await paymentRepository.sumForInvoice(id, client)) > 0) {
        throw badRequest('An invoice with recorded payments cannot be cancelled');
      }
      // Cancelling a membership sale also cancels the membership — but only if
      // none of its hours have been used yet.
      if (invoice.membership_id) {
        const membership = await membershipRepository.lockById(invoice.membership_id, client);
        if (membership && membership.minutes_used > 0) {
          throw badRequest('This membership has already been used, so its invoice cannot be cancelled');
        }
        await membershipRepository.setStatus(invoice.membership_id, 'CANCELLED', client);
      }
      await invoiceRepository.update(id, { payment_status: 'CANCELLED' }, client);
    });
    emitEvent('invoice:updated', { invoice_id: id });
    emitEvent('dashboard:updated');
    return this.get(id);
  },
};
