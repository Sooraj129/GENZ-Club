/**
 * Session endpoints → server/src/controllers/sessionController.ts
 * Business rules live in server/src/services/sessionService.ts.
 */
import type { EndPreview, Quote, Session } from '../types';
import { syncServerTime } from '../utils/serverClock';
import { get, getPage, post, type QueryParams } from './request';

/** Wall-clock times in IST, exactly as staff type them. The server converts. */
export interface SessionWindow {
  start_date: string; // YYYY-MM-DD
  start_time: string; // HH:mm
  end_date: string;
  end_time: string;
}

export const sessionsApi = {
  /** POST /api/sessions/quote — server-calculated duration, rate, estimate and availability. */
  quote: (body: SessionWindow & { console_id: string; membership_id?: string }) => post<Quote>('/sessions/quote', body),

  /** POST /api/sessions — 409 if the console is already booked for that time. */
  create: (body: SessionWindow & { console_id: string; customer_id: string; membership_id?: string }) => post<Session>('/sessions', body),

  /** GET /api/sessions — history with filters + pagination. */
  list: (params: QueryParams) => getPage<Session>('/sessions', params),

  /** GET /api/sessions/active — playing, paused and upcoming sessions; also re-syncs the server clock. */
  async active() {
    const sentAt = Date.now();
    const data = await get<{ active: Session[]; paused: Session[]; upcoming: Session[]; server_time: string }>('/sessions/active');
    syncServerTime(data.server_time, sentAt);
    return data;
  },

  /** GET /api/sessions/:id */
  get: (id: string) => get<Session>(`/sessions/${id}`),

  /** POST /api/sessions/:id/start — start a scheduled session now. */
  start: (id: string) => post<Session>(`/sessions/${id}/start`),

  /** POST /api/sessions/:id/pause — stop the clock; the console is freed until Resume. */
  pause: (id: string) => post<Session>(`/sessions/${id}/pause`),

  /** POST /api/sessions/:id/resume — continue the remaining time now (optionally on another console of the same type). */
  resume: (id: string, consoleId?: string) => post<Session>(`/sessions/${id}/resume`, consoleId ? { console_id: consoleId } : {}),

  /** GET /api/sessions/:id/end-preview — what ending now would cost (for the confirm dialog). */
  endPreview: (id: string) => get<EndPreview>(`/sessions/${id}/end-preview`),

  /** POST /api/sessions/:id/end — end early; returns the session with its new invoice. */
  end: (id: string) => post<Session>(`/sessions/${id}/end`),

  /** POST /api/sessions/:id/extend — add minutes if the console is free. */
  extend: (id: string, minutes: number) => post<Session>(`/sessions/${id}/extend`, { minutes }),

  /** POST /api/sessions/:id/cancel — only for sessions that haven't started. */
  cancel: (id: string) => post<Session>(`/sessions/${id}/cancel`),
};
