/**
 * Single entry point for every API call the web app makes.
 *
 *   import { api } from '../api';
 *   api.sessions.create({...})
 *
 * Each area lives in its own file, and every function's comment names the
 * server route it calls — so from any button you can find the backend code:
 *
 *   api.auth      → api/auth.ts       → /api/auth/*
 *   api.customers → api/customers.ts  → /api/customers/*
 *   api.consoles  → api/consoles.ts   → /api/consoles/*
 *   api.sessions  → api/sessions.ts   → /api/sessions/*
 *   api.memberships → api/memberships.ts → /api/memberships/*, /api/membership-plans/*
 *   api.invoices  → api/billing.ts    → /api/invoices/*
 *   api.payments  → api/billing.ts    → /api/payments/*
 *   api.dashboard → api/admin.ts      → /api/dashboard/*, /api/reports
 *   api.settings  → api/admin.ts      → /api/settings, /api/pricing
 *   api.users     → api/admin.ts      → /api/users/*
 *
 * Shared plumbing (base URL, auth header, request IDs, logging) is in api/client.ts.
 */
import { dashboardApi, settingsApi, usersApi } from './admin';
import { authApi } from './auth';
import { invoicesApi, paymentsApi } from './billing';
import { consolesApi } from './consoles';
import { customersApi } from './customers';
import { membershipsApi } from './memberships';
import { sessionsApi } from './sessions';

export const api = {
  auth: authApi,
  customers: customersApi,
  consoles: consolesApi,
  sessions: sessionsApi,
  memberships: membershipsApi,
  invoices: invoicesApi,
  payments: paymentsApi,
  dashboard: dashboardApi,
  settings: settingsApi,
  users: usersApi,
};

export type { SessionWindow } from './sessions';
