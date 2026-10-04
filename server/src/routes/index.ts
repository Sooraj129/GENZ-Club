import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController, userController } from '../controllers/authController.js';
import {
  dashboardController,
  invoiceController,
  paymentController,
  settingsController,
} from '../controllers/billingController.js';
import { consoleController } from '../controllers/consoleController.js';
import { customerController } from '../controllers/customerController.js';
import { membershipController } from '../controllers/membershipController.js';
import { sessionController } from '../controllers/sessionController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { env } from '../config/env.js';

const adminOnly = requireRole('ADMIN');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' },
});

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', server_time: new Date().toISOString() } });
});

// ---- Auth
router.post('/auth/login', loginLimiter, authController.login);
router.post('/auth/logout', authenticate, authController.logout);
router.get('/auth/me', authenticate, authController.me);

// Everything below requires a signed-in user.
router.use(authenticate);

router.get('/time', (_req, res) => res.json({ success: true, data: { server_time: new Date().toISOString() } }));

// ---- Users (admin)
router.get('/users', adminOnly, userController.list);
router.post('/users', adminOnly, userController.create);
router.put('/users/:id', adminOnly, userController.update);

// ---- Customers
router.post('/customers', customerController.create);
router.get('/customers', customerController.list);
router.get('/customers/search', customerController.search);
router.get('/customers/:id', customerController.get);
router.get('/customers/:id/sessions', customerController.history);
router.put('/customers/:id', customerController.update);

// ---- Consoles (staff can view; admin manages)
router.get('/consoles', consoleController.list);
router.get('/consoles/:id', consoleController.get);
router.get('/consoles/:id/schedule', consoleController.schedule);
router.post('/consoles', adminOnly, consoleController.create);
router.put('/consoles/:id', adminOnly, consoleController.update);
router.delete('/consoles/:id', adminOnly, consoleController.remove);

// ---- Sessions
router.post('/sessions/quote', sessionController.quote);
router.post('/sessions', sessionController.create);
router.get('/sessions', sessionController.list);
router.get('/sessions/active', sessionController.active);
router.get('/sessions/:id', sessionController.get);
router.post('/sessions/:id/start', sessionController.start);
router.post('/sessions/:id/pause', sessionController.pause);
router.post('/sessions/:id/resume', sessionController.resume);
router.get('/sessions/:id/end-preview', sessionController.endPreview);
router.post('/sessions/:id/end', sessionController.end);
router.post('/sessions/:id/extend', sessionController.extend);
router.post('/sessions/:id/cancel', sessionController.cancel);

// ---- Memberships (prepaid packages). Staff sell them; admins manage plans.
router.get('/membership-plans', membershipController.listPlans);
router.post('/membership-plans', adminOnly, membershipController.createPlan);
router.put('/membership-plans/:id', adminOnly, membershipController.updatePlan);
router.get('/memberships', membershipController.list);
router.post('/memberships', membershipController.sell);
router.get('/memberships/:id', membershipController.get);
router.get('/customers/:id/memberships', membershipController.forCustomer);

// ---- Invoices
router.get('/invoices', invoiceController.list);
router.get('/invoices/:id', invoiceController.get);
router.get('/invoices/:id/pdf', invoiceController.pdf);
router.post('/invoices/:id/discount', adminOnly, invoiceController.discount);
router.post('/invoices/:id/cancel', adminOnly, invoiceController.cancel);

// ---- Payments
router.post('/payments', paymentController.create);
router.get('/payments', paymentController.list);
router.put('/payments/:id', adminOnly, paymentController.update);

// ---- Dashboard & reports
router.get('/dashboard/summary', dashboardController.summary);
router.get('/dashboard/revenue', dashboardController.revenue);
router.get('/reports', adminOnly, dashboardController.report);

// ---- Settings & pricing
router.get('/settings', settingsController.get);
router.put('/settings', adminOnly, settingsController.update);
router.get('/pricing', settingsController.pricing);
router.put('/pricing', adminOnly, settingsController.updatePricing);
