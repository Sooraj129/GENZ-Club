/** Console endpoints → server/src/controllers/consoleController.ts */
import type { ConsoleStatus, ConsoleType, GameConsole, Session } from '../types';
import { del, get, post, put } from './request';

export interface ConsoleInput {
  console_number: string;
  console_type: ConsoleType;
  /** Per-console price; null = use the standard price for its type. */
  hourly_rate: number | null;
  status: ConsoleStatus;
}

export const consolesApi = {
  /** GET /api/consoles — all consoles with live status and current/next session. */
  list: () => get<GameConsole[]>('/consoles'),

  /** GET /api/consoles/:id/schedule?date=YYYY-MM-DD — bookings on that day. */
  schedule: (id: string, date: string) => get<Session[]>(`/consoles/${id}/schedule`, { date }),

  /** POST /api/consoles (admin) */
  create: (body: ConsoleInput) => post<GameConsole>('/consoles', body),

  /** PUT /api/consoles/:id (admin) */
  update: (id: string, body: Partial<ConsoleInput>) => put<GameConsole>(`/consoles/${id}`, body),

  /** DELETE /api/consoles/:id (admin) — only for consoles that were never booked. */
  remove: (id: string) => del<{ deleted: true }>(`/consoles/${id}`),
};
