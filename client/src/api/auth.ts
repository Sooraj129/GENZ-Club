/** Auth endpoints → server/src/controllers/authController.ts */
import type { User } from '../types';
import { syncServerTime } from '../utils/serverClock';
import { get, post } from './request';

export const authApi = {
  /** POST /api/auth/login — returns a JWT and the user. */
  login: (email: string, password: string) => post<{ token: string; user: User }>('/auth/login', { email, password }),

  /** POST /api/auth/logout — tokens are stateless; the client discards its token. */
  logout: () => post('/auth/logout'),

  /** GET /api/auth/me — used on page load to restore the session from a stored token. */
  me: () => get<{ user: User; server_time: string }>('/auth/me'),

  /** GET /api/time — measures the server clock so countdown timers ignore this PC's clock. */
  async syncTime() {
    const sentAt = Date.now();
    const { server_time } = await get<{ server_time: string }>('/time');
    syncServerTime(server_time, sentAt);
  },
};
