import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import { membershipService } from '../services/membershipService.js';
import { idParamSchema } from '../validators/common.js';
import { membershipListQuery, membershipPlanSchema, sellMembershipSchema, updateMembershipPlanSchema } from '../validators/schemas.js';
import { ok, paginated, parse } from '../utils/http.js';

/** Plans are entered in hours in the UI but stored in minutes. */
const hoursToMinutes = (hours: number) => Math.round(hours * 60);

export const membershipController = {
  // ---- plans
  async listPlans(req: Request, res: Response) {
    // Admins see retired plans too (to re-activate them); staff only see what's on sale.
    ok(res, await membershipService.listPlans(req.user?.role === 'ADMIN' && req.query.all === '1'));
  },

  async createPlan(req: Request, res: Response) {
    const { hours, ...rest } = parse(membershipPlanSchema, req.body);
    ok(res, await membershipService.createPlan({ ...rest, minutes: hoursToMinutes(hours) }), 201);
  },

  async updatePlan(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    const { hours, ...rest } = parse(updateMembershipPlanSchema, req.body);
    ok(res, await membershipService.updatePlan(id, { ...rest, ...(hours !== undefined ? { minutes: hoursToMinutes(hours) } : {}) }));
  },

  // ---- memberships
  async sell(req: Request, res: Response) {
    const { customer_id, plan_id } = parse(sellMembershipSchema, req.body);
    ok(res, await membershipService.sell(customer_id, plan_id, currentUser(req)), 201);
  },

  async list(req: Request, res: Response) {
    const q = parse(membershipListQuery, req.query);
    paginated(res, await membershipService.list({ search: q.search, state: q.state }, q.page, q.pageSize), q.page, q.pageSize);
  },

  async get(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    ok(res, await membershipService.get(id));
  },

  async forCustomer(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    ok(res, await membershipService.listForCustomer(id));
  },
};
