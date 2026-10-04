/**
 * Tiny wrappers that unwrap the server's `{ success, data, meta }` envelope,
 * so endpoint files read as plain one-liners:
 *
 *   list: () => get<GameConsole[]>('/consoles')
 */
import type { Paginated } from '../types';
import { http } from './client';

export type QueryParams = Record<string, string | number | undefined | null>;

/** Drops empty filters so URLs stay clean (?status=&page=1 → ?page=1). */
const clean = (params: QueryParams = {}) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));

export async function get<T>(url: string, params?: QueryParams): Promise<T> {
  const res = await http.get(url, { params: clean(params) });
  return res.data.data;
}

export async function getPage<T>(url: string, params?: QueryParams): Promise<Paginated<T>> {
  const res = await http.get(url, { params: clean(params) });
  return { data: res.data.data, meta: res.data.meta };
}

export async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await http.post(url, body);
  return res.data.data;
}

export async function put<T>(url: string, body?: unknown): Promise<T> {
  const res = await http.put(url, body);
  return res.data.data;
}

export async function del<T>(url: string): Promise<T> {
  const res = await http.delete(url);
  return res.data.data;
}
