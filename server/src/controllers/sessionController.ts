import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import { sessionService } from '../services/sessionService.js';
import { idParamSchema } from '../validators/common.js';
import {
  createSessionSchema,
  extendSessionSchema,
  quoteSessionSchema,
  resumeSessionSchema,
  sessionListQuery,
} from '../validators/schemas.js';
import { ok, paginated, parse } from '../utils/http.js';
import { addDays, businessDateTimeToDate, startOfBusinessDay } from '../utils/time.js';

const toWindow = (b: { start_date: string; start_time: string; end_date: string; end_time: string }) => ({
  start: businessDateTimeToDate(b.start_date, b.start_time),
  end: businessDateTimeToDate(b.end_date, b.end_time),
});

export const sessionController = {
  async quote(req: Request, res: Response) {
    const body = parse(quoteSessionSchema, req.body);
    const { start, end } = toWindow(body);
    ok(res, await sessionService.quote(body.console_id, start, end, body.membership_id));
  },

  async create(req: Request, res: Response) {
    const body = parse(createSessionSchema, req.body);
    const { start, end } = toWindow(body);
    const session = await sessionService.create(
      { customer_id: body.customer_id, console_id: body.console_id, start, end, membership_id: body.membership_id },
      currentUser(req),
    );
    ok(res, session, 201);
  },

  async list(req: Request, res: Response) {
    const q = parse(sessionListQuery, req.query);
    const result = await sessionService.list(
      {
        from: q.from ? startOfBusinessDay(q.from) : undefined,
        to: q.to ? startOfBusinessDay(addDays(q.to, 1)) : undefined,
        customer: q.customer,
        phone: q.phone,
        consoleId: q.console_id,
        consoleType: q.console_type,
        status: q.status,
        paymentStatus: q.payment_status,
      },
      q.page,
      q.pageSize,
    );
    paginated(res, result, q.page, q.pageSize);
  },

  /** Includes server_time so clients can align their countdowns with the server clock. */
  async active(_req: Request, res: Response) {
    const [active, paused, upcoming] = await Promise.all([
      sessionService.listActive(),
      sessionService.listPaused(),
      sessionService.listUpcoming(),
    ]);
    ok(res, { active, paused, upcoming, server_time: new Date().toISOString() });
  },

  async get(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    ok(res, await sessionService.get(id));
  },

  async start(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    ok(res, await sessionService.start(id));
  },

  async pause(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    ok(res, await sessionService.pause(id));
  },

  async resume(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    const { console_id } = parse(resumeSessionSchema, req.body ?? {});
    ok(res, await sessionService.resume(id, console_id));
  },

  async endPreview(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    ok(res, await sessionService.endPreview(id));
  },

  async end(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    ok(res, await sessionService.end(id));
  },

  async extend(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    const { minutes } = parse(extendSessionSchema, req.body);
    ok(res, await sessionService.extend(id, minutes));
  },

  async cancel(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    ok(res, await sessionService.cancel(id));
  },
};
