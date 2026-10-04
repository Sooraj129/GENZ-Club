/**
 * Membership packages (prepaid play time), e.g. "799 Package — 6 hours, 30 days".
 *
 *   Plans        what can be sold (admin manages)
 *   Memberships  a plan bought by a customer: a balance of minutes + expiry date
 *
 * Selling a membership creates an invoice for its price (paid like any other
 * invoice). Sessions booked "on" a membership use its minutes first when they're
 * settled; anything beyond the balance is billed at the hourly rate.
 * The deduction happens in sessionService.finalize().
 */
import { withTransaction, type Queryable } from '../config/db.js';
import { customerRepository } from '../repositories/customerRepository.js';
import { membershipPlanRepository, membershipRepository } from '../repositories/membershipRepository.js';
import { emitEvent } from '../sockets/index.js';
import type { AuthUser, ConsoleType, Membership } from '../types/index.js';
import { badRequest, conflict, isPgError, notFound, PG } from '../utils/errors.js';
import { now } from '../utils/time.js';
import { invoiceService } from './invoiceService.js';

export interface PlanInput {
  name: string;
  price: number;
  minutes: number;
  console_type: ConsoleType | null;
  validity_days: number;
}

/** Minutes still available on a membership right now (0 if expired/cancelled). */
export function minutesAvailable(m: Membership, at: Date = now()): number {
  if (m.status !== 'ACTIVE' || m.expires_at.getTime() <= at.getTime()) return 0;
  return Math.max(0, m.minutes_total - m.minutes_used);
}

export const membershipService = {
  // ------------------------------------------------------------------- plans
  listPlans(includeInactive = false) {
    return membershipPlanRepository.list(includeInactive);
  },

  async createPlan(input: PlanInput) {
    try {
      return await membershipPlanRepository.create(input);
    } catch (err) {
      if (isPgError(err, PG.UNIQUE_VIOLATION)) throw conflict(`A plan named "${input.name}" already exists`);
      throw err;
    }
  },

  /** Editing a plan only affects future sales — sold memberships keep their copy. */
  async updatePlan(id: string, input: Partial<PlanInput & { is_active: boolean }>) {
    try {
      const plan = await membershipPlanRepository.update(id, input);
      if (!plan) throw notFound('Plan not found');
      return plan;
    } catch (err) {
      if (isPgError(err, PG.UNIQUE_VIOLATION)) throw conflict(`A plan named "${input.name}" already exists`);
      throw err;
    }
  },

  // ------------------------------------------------------------- memberships
  /** Sells a plan to a customer: creates the membership and its invoice together. */
  async sell(customerId: string, planId: string, user: AuthUser) {
    const result = await withTransaction(async (client) => {
      const customer = await customerRepository.findById(customerId, client);
      if (!customer) throw notFound('Customer not found');
      const plan = await membershipPlanRepository.findById(planId, client);
      if (!plan) throw notFound('Plan not found');
      if (!plan.is_active) throw badRequest(`The plan "${plan.name}" is no longer on sale`);

      const purchasedAt = now();
      const membership = await membershipRepository.insert(
        {
          customer_id: customer.id,
          plan_id: plan.id,
          plan_name: plan.name,
          console_type: plan.console_type,
          minutes_total: plan.minutes,
          price: plan.price,
          expires_at: new Date(purchasedAt.getTime() + plan.validity_days * 86_400_000),
          created_by: user.id,
        },
        client,
      );
      const invoice = await invoiceService.createForMembership(membership, client);
      return { membership, invoice };
    });
    emitEvent('membership:updated', { membership_id: result.membership.id, customer_id: customerId });
    emitEvent('invoice:created', { invoice_id: result.invoice.id, invoice_number: result.invoice.invoice_number });
    emitEvent('dashboard:updated');
    return { membership: await this.get(result.membership.id), invoice: result.invoice };
  },

  async get(id: string) {
    const m = await membershipRepository.findView(id);
    if (!m) throw notFound('Membership not found');
    return m;
  },

  list(filters: { search?: string; state?: string }, page: number, pageSize: number) {
    return membershipRepository.list(filters, pageSize, (page - 1) * pageSize);
  },

  listForCustomer(customerId: string) {
    return membershipRepository.listForCustomer(customerId);
  },

  /**
   * Checks a membership can be used for a session on a console of `consoleType`.
   * Returns the minutes available now.
   */
  async assertUsable(membershipId: string, customerId: string, consoleType: ConsoleType, db?: Queryable): Promise<number> {
    const m = await membershipRepository.findById(membershipId, db);
    if (!m || m.customer_id !== customerId) throw badRequest('This membership does not belong to the selected customer');
    if (m.status === 'CANCELLED') throw badRequest('This membership has been cancelled');
    if (m.expires_at.getTime() <= now().getTime()) throw badRequest('This membership has expired');
    if (m.console_type && m.console_type !== consoleType) throw badRequest(`This membership is only valid on ${m.console_type} consoles`);
    const left = minutesAvailable(m);
    if (left <= 0) throw badRequest('This membership has no hours left');
    return left;
  },
};
