/**
 * Dashboard, reports, settings and users.
 *   dashboard/reports → server/src/services/reportService.ts
 *   settings/pricing  → server/src/services/settingsService.ts
 *   users             → server/src/services/userService.ts
 */
import type { BusinessSettings, ConsoleType, DashboardSummary, Pricing, ReportData, RevenuePoint, Role, User } from '../types';
import { syncServerTime } from '../utils/serverClock';
import { get, post, put } from './request';

export const dashboardApi = {
  /** GET /api/dashboard/summary — top cards, console overview, active sessions. */
  async summary() {
    const sentAt = Date.now();
    const data = await get<DashboardSummary>('/dashboard/summary');
    syncServerTime(data.server_time, sentAt);
    return data;
  },

  /** GET /api/dashboard/revenue?days=7 — daily revenue split by PS4/PS5. */
  revenue: (days: number) => get<RevenuePoint[]>('/dashboard/revenue', { days }),

  /** GET /api/reports?from=&to=&group=day|week|month (admin) */
  report: (params: { from: string; to: string; group: string }) => get<ReportData>('/reports', params),
};

export const settingsApi = {
  /** GET /api/settings — business settings + pricing. */
  get: () => get<{ settings: BusinessSettings; pricing: Pricing[] }>('/settings'),

  /** PUT /api/settings (admin) */
  update: (body: Partial<BusinessSettings>) => put<BusinessSettings>('/settings', body),

  /** PUT /api/pricing (admin) — affects new sessions only. */
  updatePricing: (prices: Array<{ console_type: ConsoleType; hourly_rate: number }>) => put<Pricing[]>('/pricing', { prices }),
};

export interface UserInput {
  name: string;
  email: string;
  password: string;
  role: Role;
  is_active: boolean;
}

export const usersApi = {
  /** GET /api/users (admin) */
  list: () => get<User[]>('/users'),

  /** POST /api/users (admin) */
  create: (body: Omit<UserInput, 'is_active'>) => post<User>('/users', body),

  /** PUT /api/users/:id (admin) — omit password to keep it unchanged. */
  update: (id: string, body: Partial<UserInput>) => put<User>(`/users/${id}`, body),
};
