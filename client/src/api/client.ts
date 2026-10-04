/**
 * HTTP client shared by every API call.
 *
 * Where requests go
 *   The web app (Vite, :5173) calls the API server directly on its own port.
 *   Set VITE_API_URL in client/.env — default http://localhost:5000.
 *
 * What every request gets
 *   - Authorization: Bearer <token>       (if logged in)
 *   - X-Request-Id: <id>                  (same ID appears in the server log)
 *
 * Debugging
 *   In development every call is logged to the browser console:
 *     [API] POST /sessions → 201 in 42ms  (rid 3f9c…)
 *   Expand the group to see the request body and response. Failed calls are
 *   always logged (also in production) with their request ID — search the
 *   server log for that ID to find the matching server-side entry.
 *   To enable logging in a production build: localStorage.setItem('gc_debug', '1')
 */
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { uniqueKey } from '../utils/id';

// ----------------------------------------------------------------- configuration

/**
 * Base URL of the API server, e.g. http://localhost:5000 (no trailing slash).
 * An empty VITE_API_URL means "same domain as the web app" (Vercel: /api).
 * Not set at all → local development default http://localhost:5000.
 */
export const API_ORIGIN = (import.meta.env.VITE_API_URL ?? 'http://localhost:5000').replace(/\/$/, '');

/**
 * How live updates arrive:
 *   'socket' — Socket.IO push (own server, e.g. local development)
 *   'poll'   — refresh every 10 s (Vercel, where WebSockets aren't available)
 */
export const REALTIME_MODE: 'socket' | 'poll' = import.meta.env.VITE_REALTIME === 'poll' ? 'poll' : 'socket';

const debugEnabled = (() => {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem('gc_debug') === '1';
  } catch {
    return false;
  }
})();

// ----------------------------------------------------------------- token storage

const TOKEN_KEY = 'gc_token';

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage unavailable — session lasts until reload */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

// ----------------------------------------------------------------- axios instance

export const http = axios.create({ baseURL: `${API_ORIGIN}/api`, timeout: 20_000 });

/** Extra fields we attach to each request config for logging. */
type TracedConfig = InternalAxiosRequestConfig & { meta?: { requestId: string; startedAt: number } };

http.interceptors.request.use((config: TracedConfig) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;

  const requestId = uniqueKey().slice(0, 12);
  config.headers['X-Request-Id'] = requestId;
  config.meta = { requestId, startedAt: performance.now() };
  return config;
});

function describe(config: TracedConfig | undefined) {
  const method = (config?.method ?? 'get').toUpperCase();
  const query = config?.params && Object.keys(config.params).length ? `?${new URLSearchParams(config.params).toString()}` : '';
  const ms = config?.meta ? Math.round(performance.now() - config.meta.startedAt) : 0;
  return { label: `${method} ${config?.url ?? ''}${query}`, ms, requestId: config?.meta?.requestId };
}

function logSuccess(res: AxiosResponse) {
  if (!debugEnabled) return;
  const { label, ms, requestId } = describe(res.config as TracedConfig);
  console.groupCollapsed(`%c[API]%c ${label} → ${res.status} in ${ms}ms  (rid ${requestId})`, 'color:#2a78d6;font-weight:bold', 'color:inherit');
  if (res.config.data) console.log('request body:', safeJson(res.config.data));
  console.log('response:', res.data);
  console.groupEnd();
}

function logFailure(error: AxiosError) {
  const { label, ms, requestId } = describe(error.config as TracedConfig);
  const status = error.response?.status ?? 'NETWORK ERROR';
  const message = (error.response?.data as ApiErrorBody | undefined)?.message ?? error.message;
  // Failures are always logged — they're what you need when debugging.
  console.groupCollapsed(`%c[API]%c ${label} → ${status} in ${ms}ms  (rid ${requestId})  ${message}`, 'color:#d03b3b;font-weight:bold', 'color:inherit');
  if (error.config?.data) console.log('request body:', safeJson(error.config.data));
  console.log('response:', error.response?.data ?? error.message);
  if (!error.response) console.log(`Is the API running at ${API_ORIGIN}? Check VITE_API_URL and the server's CLIENT_ORIGIN (CORS).`);
  console.groupEnd();
}

const safeJson = (data: unknown) => {
  if (typeof data !== 'string') return data;
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === 'object' && 'password' in parsed) return { ...parsed, password: '••••••' };
    return parsed;
  } catch {
    return data;
  }
};

let onUnauthorized: (() => void) | null = null;
/** AuthContext registers this so an expired token logs the user out everywhere. */
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

http.interceptors.response.use(
  (res) => {
    logSuccess(res);
    return res;
  },
  (error: AxiosError) => {
    logFailure(error);
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) onUnauthorized?.();
    return Promise.reject(error);
  },
);

// ----------------------------------------------------------------- response helpers

export interface ApiErrorBody {
  success: false;
  message: string;
  requestId?: string;
  data?: unknown;
}

/** Shape of every successful response: { success: true, data, meta? }. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: unknown;
}

/**
 * Best human-readable message for any failed call. Server errors (5xx) include
 * a short reference so staff can quote it and you can find it in the server log.
 */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as ApiErrorBody | undefined;
    if (body?.message) {
      const status = err.response?.status ?? 0;
      return status >= 500 && body.requestId ? `${body.message} (ref ${body.requestId.slice(0, 8)})` : body.message;
    }
    if (err.code === 'ECONNABORTED') return 'The server took too long to respond.';
    if (!err.response) return `Cannot reach the server at ${API_ORIGIN}. Is it running?`;
  }
  return fallback;
}

export function errorData<T = unknown>(err: unknown): T | undefined {
  return axios.isAxiosError(err) ? ((err.response?.data as ApiErrorBody | undefined)?.data as T) : undefined;
}

export function errorStatus(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined;
}
