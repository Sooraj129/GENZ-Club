import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import { invoicePdfService } from '../services/invoicePdfService.js';
import { invoiceService } from '../services/invoiceService.js';
import { paymentService } from '../services/paymentService.js';
import { reportService } from '../services/reportService.js';
import { settingsService } from '../services/settingsService.js';
import { idParamSchema } from '../validators/common.js';
import {
  createPaymentSchema,
  discountSchema,
  invoiceListQuery,
  paymentListQuery,
  reportQuery,
  revenueQuery,
  updatePaymentSchema,
  updatePricingSchema,
  updateSettingsSchema,
} from '../validators/schemas.js';
import { ok, paginated, parse } from '../utils/http.js';
import { addDays, startOfBusinessDay } from '../utils/time.js';

const range = (from?: string, to?: string) => ({
  from: from ? startOfBusinessDay(from) : undefined,
  to: to ? startOfBusinessDay(addDays(to, 1)) : undefined,
});

export const invoiceController = {
  async list(req: Request, res: Response) {
    const q = parse(invoiceListQuery, req.query);
    const result = await invoiceService.list(
      { search: q.search, ...range(q.from, q.to), paymentStatus: q.payment_status, customerId: q.customer_id },
      q.page,
      q.pageSize,
    );
    paginated(res, result, q.page, q.pageSize);
  },

  async get(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    const [invoice, business] = await Promise.all([invoiceService.get(id), settingsService.get()]);
    ok(res, { ...invoice, business });
  },

  async pdf(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    const [invoice, business] = await Promise.all([invoiceService.get(id), settingsService.get()]);
    const buffer = await invoicePdfService.render(invoice, business);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoice_number}.pdf"`);
    res.send(buffer);
  },

  async discount(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    ok(res, await invoiceService.applyDiscount(id, parse(discountSchema, req.body).discount));
  },

  async cancel(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    ok(res, await invoiceService.cancel(id));
  },
};

export const paymentController = {
  async create(req: Request, res: Response) {
    const result = await paymentService.record(parse(createPaymentSchema, req.body), currentUser(req));
    ok(res, result, result.replayed ? 200 : 201);
  },

  async list(req: Request, res: Response) {
    const q = parse(paymentListQuery, req.query);
    const result = await paymentService.list({ ...range(q.from, q.to), method: q.method, search: q.search }, q.page, q.pageSize);
    paginated(res, result, q.page, q.pageSize);
  },

  async update(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    ok(res, await paymentService.update(id, parse(updatePaymentSchema, req.body)));
  },
};

export const dashboardController = {
  async summary(_req: Request, res: Response) {
    ok(res, { ...(await reportService.dashboardSummary()), server_time: new Date().toISOString() });
  },

  async revenue(req: Request, res: Response) {
    const { days } = parse(revenueQuery, req.query);
    ok(res, await reportService.revenueSeries(days));
  },

  async report(req: Request, res: Response) {
    const q = parse(reportQuery, req.query);
    ok(res, await reportService.report(q.from, q.to, q.group));
  },
};

export const settingsController = {
  async get(_req: Request, res: Response) {
    const [settings, pricing] = await Promise.all([settingsService.get(), settingsService.listPricing()]);
    ok(res, { settings, pricing });
  },

  async update(req: Request, res: Response) {
    ok(res, await settingsService.update(parse(updateSettingsSchema, req.body)));
  },

  async pricing(_req: Request, res: Response) {
    ok(res, await settingsService.listPricing());
  },

  async updatePricing(req: Request, res: Response) {
    const { prices } = parse(updatePricingSchema, req.body);
    for (const p of prices) await settingsService.updatePricing(p.console_type, p.hourly_rate);
    ok(res, await settingsService.listPricing());
  },
};
