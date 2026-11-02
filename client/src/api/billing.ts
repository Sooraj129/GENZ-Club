/**
 * Invoices & payments → server/src/controllers/billingController.ts
 * Money rules live in server/src/services/{billingService,invoiceService,paymentService}.ts.
 */
import type { Invoice, InvoiceDetail, Payment, PaymentMethod } from '../types';
import { http } from './client';
import { get, getPage, post, put, type QueryParams } from './request';

export const invoicesApi = {
  /** GET /api/invoices?search=&from=&to=&payment_status= */
  list: (params: QueryParams) => getPage<Invoice>('/invoices', params),

  /** GET /api/invoices/:id — invoice + payments + business details for printing. */
  get: (id: string) => get<InvoiceDetail>(`/invoices/${id}`),

  /** POST /api/invoices/:id/discount (admin) — only before any payment. */
  discount: (id: string, discount: number) => post<InvoiceDetail>(`/invoices/${id}/discount`, { discount }),

  /** POST /api/invoices/:id/cancel (admin) — only if nothing was paid. */
  cancel: (id: string) => post<InvoiceDetail>(`/invoices/${id}/cancel`),

  /** GET /api/invoices/:id/pdf — downloads the PDF through the browser. */
  async downloadPdf(id: string, invoiceNumber: string) {
    const res = await http.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${invoiceNumber}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

export interface PaymentInput {
  invoice_id: string;
  amount: number;
  payment_method: PaymentMethod;
  reference?: string;
  /** Same key for retries of the same payment → the server never charges twice. */
  idempotency_key: string;
}

export const paymentsApi = {
  /** GET /api/payments?from=&to=&method=&search= */
  list: (params: QueryParams) => getPage<Payment>('/payments', params),

  /**
   * GET /api/payments/export — downloads an Excel file: a Summary sheet plus one
   * sheet per date. Uses the same filters as the list; no dates → today.
   */
  async exportExcel(params: QueryParams) {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));
    const res = await http.get('/payments/export', { params: clean, responseType: 'blob' });
    // Use the server's file name, e.g. payments_2026-11-01_to_2026-11-02.xlsx
    const disposition = String(res.headers['content-disposition'] ?? '');
    const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'payments.xlsx';
    const url = URL.createObjectURL(res.data as Blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return name;
  },

  /** POST /api/payments — returns the payment and the updated invoice. `replayed` = this was a retry. */
  create: (body: PaymentInput) => post<{ payment: Payment; invoice: InvoiceDetail; replayed: boolean }>('/payments', body),

  /** PUT /api/payments/:id (admin) — fix method/reference; amounts can't change. */
  update: (id: string, body: { payment_method?: PaymentMethod; reference?: string | null }) => put<Payment>(`/payments/${id}`, body),
};
