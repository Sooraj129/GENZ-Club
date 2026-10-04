import type { Request, Response } from 'express';
import { customerService } from '../services/customerService.js';
import { idParamSchema, paginationSchema } from '../validators/common.js';
import {
  createCustomerSchema,
  customerListQuery,
  customerSearchQuery,
  updateCustomerSchema,
} from '../validators/schemas.js';
import { ok, paginated, parse } from '../utils/http.js';

export const customerController = {
  async create(req: Request, res: Response) {
    ok(res, await customerService.create(parse(createCustomerSchema, req.body)), 201);
  },

  async list(req: Request, res: Response) {
    const q = parse(customerListQuery, req.query);
    paginated(res, await customerService.list(q.search, q.page, q.pageSize), q.page, q.pageSize);
  },

  async search(req: Request, res: Response) {
    const { q } = parse(customerSearchQuery, req.query);
    // Normalise phone-looking input (strip +91, spaces) before matching.
    const term = /^[\d\s+-]+$/.test(q) ? q.replace(/[\s-]/g, '').replace(/^\+?91(?=\d{10}$)/, '') : q;
    ok(res, await customerService.search(term));
  },

  async get(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    ok(res, await customerService.getProfile(id));
  },

  async history(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    const { page, pageSize } = parse(paginationSchema, req.query);
    paginated(res, await customerService.history(id, page, pageSize), page, pageSize);
  },

  async update(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    ok(res, await customerService.update(id, parse(updateCustomerSchema, req.body)));
  },
};
