/**
 * Membership packages → server/src/controllers/membershipController.ts
 * Rules (selling, balance, expiry) live in server/src/services/membershipService.ts;
 * minutes are deducted when a session is settled (sessionService.finalize).
 */
import type { ConsoleType, Invoice, Membership, MembershipPlan } from '../types';
import { get, getPage, post, put, type QueryParams } from './request';

export interface PlanInput {
  name: string;
  price: number;
  /** Included play time in hours (server stores minutes). */
  hours: number;
  console_type: ConsoleType | null;
  validity_days: number;
}

export const membershipsApi = {
  /** GET /api/membership-plans — plans on sale (admins: ?all=1 includes retired plans). */
  plans: (all = false) => get<MembershipPlan[]>('/membership-plans', all ? { all: 1 } : undefined),

  /** POST /api/membership-plans (admin) */
  createPlan: (body: PlanInput) => post<MembershipPlan>('/membership-plans', body),

  /** PUT /api/membership-plans/:id (admin) — affects future sales only. */
  updatePlan: (id: string, body: Partial<PlanInput> & { is_active?: boolean }) => put<MembershipPlan>(`/membership-plans/${id}`, body),

  /** GET /api/memberships?search=&state= */
  list: (params: QueryParams) => getPage<Membership>('/memberships', params),

  /** GET /api/customers/:id/memberships — a customer's packages with balances. */
  forCustomer: (customerId: string) => get<Membership[]>(`/customers/${customerId}/memberships`),

  /** POST /api/memberships — sell a plan; returns the membership and its (pending) invoice. */
  sell: (customerId: string, planId: string) => post<{ membership: Membership; invoice: Invoice }>('/memberships', { customer_id: customerId, plan_id: planId }),
};
