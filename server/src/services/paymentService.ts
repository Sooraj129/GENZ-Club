import { withTransaction } from '../config/db.js';
import { invoiceRepository } from '../repositories/invoiceRepository.js';
import { paymentRepository } from '../repositories/paymentRepository.js';
import { EventBatch, emitEvent } from '../sockets/index.js';
import type { AuthUser, Payment, PaymentMethod } from '../types/index.js';
import { badRequest, conflict, isPgError, notFound, PG } from '../utils/errors.js';
import { BillingService } from './billingService.js';
import { invoiceService } from './invoiceService.js';

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const paymentService = {
  /**
   * Records a payment against an invoice.
   *
   * Duplicate protection:
   *  - the invoice row is locked, so concurrent payments are applied one at a time;
   *  - an amount larger than the remaining balance is rejected (so a fully paid
   *    invoice can never be paid again);
   *  - an optional idempotency key makes retries of the same request (double
   *    clicks, network retries) return the original payment instead of charging twice.
   */
  async record(
    input: {
      invoice_id: string;
      amount: number;
      payment_method: PaymentMethod;
      reference?: string | null;
      idempotency_key?: string | null;
    },
    user: AuthUser,
  ) {
    if (input.idempotency_key) {
      const prior = await paymentRepository.findByIdempotencyKey(input.idempotency_key);
      if (prior) return { payment: prior, invoice: await invoiceService.get(prior.invoice_id), replayed: true };
    }

    const events = new EventBatch();
    let outcome: { created: Payment } | { replayOf: Payment };
    try {
      outcome = await withTransaction(async (client): Promise<{ created: Payment } | { replayOf: Payment }> => {
        const invoice = await invoiceRepository.lockById(input.invoice_id, client);
        if (!invoice) throw notFound('Invoice not found');
        // A retry that was queued behind the original on this lock sees its committed result here.
        if (input.idempotency_key) {
          const prior = await paymentRepository.findByIdempotencyKey(input.idempotency_key, client);
          if (prior) return { replayOf: prior };
        }
        if (invoice.payment_status === 'CANCELLED') throw badRequest('This invoice has been cancelled.');
        if (invoice.payment_status === 'PAID') throw conflict(`Invoice ${invoice.invoice_number} is already fully paid.`);

        const paid = await paymentRepository.sumForInvoice(invoice.id, client);
        const balance = BillingService.balance(invoice.total, paid);
        if (input.amount <= 0) throw badRequest('Payment amount must be greater than zero.');
        if (input.amount > balance) throw badRequest(`Amount exceeds the balance due (${rupees(balance)}).`);

        const created = await paymentRepository.insert(
          {
            invoice_id: invoice.id,
            amount: input.amount,
            payment_method: input.payment_method,
            reference: input.reference ?? null,
            idempotency_key: input.idempotency_key ?? null,
            processed_by: user.id,
          },
          client,
        );
        const status = BillingService.paymentStatus(invoice.total, paid + input.amount);
        await invoiceRepository.update(invoice.id, { payment_status: status }, client);

        events.add('payment:updated', { invoice_id: invoice.id, payment_id: created.id, payment_status: status });
        events.add('invoice:updated', { invoice_id: invoice.id });
        events.add('dashboard:updated');
        return { created };
      });
    } catch (err) {
      // Two identical requests raced; the other one won — return its result.
      if (input.idempotency_key && isPgError(err, PG.UNIQUE_VIOLATION)) {
        const prior = await paymentRepository.findByIdempotencyKey(input.idempotency_key);
        if (prior) return { payment: prior, invoice: await invoiceService.get(prior.invoice_id), replayed: true };
      }
      throw err;
    }
    if ('replayOf' in outcome) {
      return { payment: outcome.replayOf, invoice: await invoiceService.get(outcome.replayOf.invoice_id), replayed: true };
    }
    events.flush();
    return { payment: outcome.created, invoice: await invoiceService.get(outcome.created.invoice_id), replayed: false };
  },

  list(
    filters: { from?: Date; to?: Date; method?: PaymentMethod; search?: string },
    page: number,
    pageSize: number,
  ) {
    return paymentRepository.list(filters, pageSize, (page - 1) * pageSize);
  },

  /** Corrects the method/reference of a recorded payment. Amounts are immutable. */
  async update(id: string, input: { payment_method?: PaymentMethod; reference?: string | null }) {
    const existing = await paymentRepository.findView(id);
    if (!existing) throw notFound('Payment not found');
    await paymentRepository.update(id, input);
    emitEvent('payment:updated', { invoice_id: existing.invoice_id, payment_id: id });
    return paymentRepository.findView(id);
  },
};
