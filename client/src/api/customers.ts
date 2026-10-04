/** Customer endpoints → server/src/controllers/customerController.ts */
import type { Customer, CustomerWithStats, Session } from '../types';
import { get, getPage, post, put, type QueryParams } from './request';

export interface CustomerInput {
  name: string;
  phone: string;
  email?: string | null;
}

export const customersApi = {
  /** GET /api/customers?search=&page= — paginated list with visit/spend stats. */
  list: (params: QueryParams) => getPage<CustomerWithStats>('/customers', params),

  /** GET /api/customers/search?q= — quick lookup by phone or name (New Session). */
  search: (q: string) => get<Customer[]>('/customers/search', { q }),

  /** GET /api/customers/:id — profile with totals. */
  get: (id: string) => get<CustomerWithStats>(`/customers/${id}`),

  /** GET /api/customers/:id/sessions — that customer's session history. */
  history: (id: string, params: QueryParams) => getPage<Session>(`/customers/${id}/sessions`, params),

  /** POST /api/customers — 409 "Customer already exists" (with the existing customer) on a duplicate phone. */
  create: (body: CustomerInput) => post<Customer>('/customers', body),

  /** PUT /api/customers/:id */
  update: (id: string, body: Partial<CustomerInput>) => put<Customer>(`/customers/${id}`, body),
};
