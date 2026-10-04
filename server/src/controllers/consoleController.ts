import type { Request, Response } from 'express';
import { consoleService } from '../services/consoleService.js';
import { idParamSchema } from '../validators/common.js';
import { consoleScheduleQuery, createConsoleSchema, updateConsoleSchema } from '../validators/schemas.js';
import { ok, parse } from '../utils/http.js';
import { addDays, startOfBusinessDay } from '../utils/time.js';

export const consoleController = {
  async list(_req: Request, res: Response) {
    ok(res, await consoleService.list());
  },

  async get(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    ok(res, await consoleService.get(id));
  },

  /** Bookings on a console for one business day (availability preview). */
  async schedule(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    const { date } = parse(consoleScheduleQuery, req.query);
    ok(res, await consoleService.schedule(id, startOfBusinessDay(date), startOfBusinessDay(addDays(date, 1))));
  },

  async create(req: Request, res: Response) {
    ok(res, await consoleService.create(parse(createConsoleSchema, req.body)), 201);
  },

  async remove(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    await consoleService.remove(id);
    ok(res, { deleted: true });
  },

  async update(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    ok(res, await consoleService.update(id, parse(updateConsoleSchema, req.body)));
  },
};
