/**
 * Payments → Excel workbook.
 *
 *   "Summary" sheet   one row per date: number of payments, Cash, UPI, Card, total
 *   one sheet per date (e.g. "01-11-2026") listing that day's payments + a total row
 *
 * Dates are business dates (Asia/Kolkata). Customers' phone numbers are left
 * out on purpose — same privacy rule as on invoices.
 */
import ExcelJS from 'exceljs';
import type { PaymentView } from '../repositories/paymentRepository.js';
import { BUSINESS_TIMEZONE } from '../config/env.js';
import { businessDate } from '../utils/time.js';

const RUPEES = '"₹"#,##0.00';
const METHODS = ['CASH', 'UPI', 'CARD'] as const;
const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' };

const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: BUSINESS_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: true });

/** 'YYYY-MM-DD' → 'DD-MM-YYYY' (also a valid sheet name: no / allowed). */
const dmy = (ymd: string) => `${ymd.slice(8, 10)}-${ymd.slice(5, 7)}-${ymd.slice(0, 4)}`;

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  row.alignment = { vertical: 'middle' };
  row.height = 20;
}

function styleTotal(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.border = { top: { style: 'thin', color: { argb: 'FF94A3B8' } } };
}

export const paymentExportService = {
  async build(payments: PaymentView[], from: string, to: string, businessName: string): Promise<Buffer> {
    // Group by business date, oldest first; payments within a day by time.
    const byDate = new Map<string, PaymentView[]>();
    for (const p of [...payments].sort((a, b) => a.paid_at.getTime() - b.paid_at.getTime())) {
      const day = businessDate(p.paid_at);
      byDate.set(day, [...(byDate.get(day) ?? []), p]);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = businessName;
    wb.created = new Date();

    // ---------------------------------------------------------------- Summary
    const summary = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 3 }] });
    summary.columns = [
      { key: 'date', width: 14 },
      { key: 'count', width: 11 },
      ...METHODS.map((m) => ({ key: m, width: 14, style: { numFmt: RUPEES } })),
      { key: 'total', width: 16, style: { numFmt: RUPEES } },
    ];
    summary.addRow([`${businessName} — Payments ${dmy(from)} to ${dmy(to)}`]).font = { bold: true, size: 13 };
    summary.addRow([]);
    styleHeader(summary.addRow(['Date', 'Payments', ...METHODS.map((m) => METHOD_LABEL[m]), 'Total']));

    const grand = { count: 0, total: 0, CASH: 0, UPI: 0, CARD: 0 };
    for (const [day, list] of byDate) {
      const byMethod = { CASH: 0, UPI: 0, CARD: 0 } as Record<(typeof METHODS)[number], number>;
      for (const p of list) byMethod[p.payment_method] += p.amount;
      const total = list.reduce((s, p) => s + p.amount, 0);
      summary.addRow({ date: dmy(day), count: list.length, ...byMethod, total });
      grand.count += list.length;
      grand.total += total;
      for (const m of METHODS) grand[m] += byMethod[m];
    }
    if (byDate.size === 0) summary.addRow(['No payments in this period']);
    styleTotal(summary.addRow({ date: 'Total', count: grand.count, CASH: grand.CASH, UPI: grand.UPI, CARD: grand.CARD, total: grand.total }));

    // ---------------------------------------------------------------- one sheet per date
    for (const [day, list] of byDate) {
      const ws = wb.addWorksheet(dmy(day), { views: [{ state: 'frozen', ySplit: 3 }] });
      ws.columns = [
        { key: 'time', width: 11 },
        { key: 'invoice', width: 20 },
        { key: 'customer', width: 22 },
        { key: 'method', width: 9 },
        { key: 'reference', width: 18 },
        { key: 'by', width: 18 },
        { key: 'amount', width: 14, style: { numFmt: RUPEES } },
      ];
      ws.addRow([`Payments on ${dmy(day)}`]).font = { bold: true, size: 13 };
      ws.addRow([]);
      styleHeader(ws.addRow(['Time', 'Invoice', 'Customer', 'Method', 'Reference', 'Processed by', 'Amount']));
      for (const p of list) {
        ws.addRow({
          time: timeFmt.format(p.paid_at).toUpperCase(),
          invoice: p.invoice_number,
          customer: p.customer_name,
          method: METHOD_LABEL[p.payment_method] ?? p.payment_method,
          reference: p.reference ?? '',
          by: p.processed_by_name ?? '',
          amount: p.amount,
        });
      }
      styleTotal(ws.addRow({ time: 'Total', amount: list.reduce((s, p) => s + p.amount, 0) }));
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  },
};
