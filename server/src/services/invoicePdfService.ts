import PDFDocument from 'pdfkit';
import type { InvoiceView } from '../repositories/invoiceRepository.js';
import type { PaymentView } from '../repositories/paymentRepository.js';
import { formatBusinessDateTime, formatDuration } from '../utils/time.js';
import type { BusinessSettings } from './settingsService.js';

type InvoiceDetail = InvoiceView & { balance_due: number; payments: PaymentView[] };

// The standard PDF fonts have no ₹ glyph, so amounts are printed as "Rs.".
const money = (n: number) => `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'PENDING',
  PARTIALLY_PAID: 'PARTIALLY PAID',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
};

export const invoicePdfService = {
  render(invoice: InvoiceDetail, business: BusinessSettings): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A5', margin: 36, info: { Title: invoice.invoice_number } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const rule = () => {
        doc.moveDown(0.5);
        doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.5).strokeColor('#999999').stroke();
        doc.moveDown(0.6);
      };
      const row = (label: string, value: string, bold = false) => {
        const y = doc.y;
        doc.font('Helvetica').fontSize(9).fillColor('#555555').text(label, left, y, { width: width / 2 });
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#111111').text(value, left + width / 2, y, { width: width / 2, align: 'right' });
        doc.moveDown(0.35);
      };

      doc.font('Helvetica-Bold').fontSize(16).fillColor('#111111').text(business.business_name.toUpperCase(), { align: 'center' });
      if (business.business_address) doc.font('Helvetica').fontSize(8).fillColor('#555555').text(business.business_address, { align: 'center' });
      if (business.business_phone) doc.font('Helvetica').fontSize(8).fillColor('#555555').text(`Phone: ${business.business_phone}`, { align: 'center' });
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(9).fillColor('#555555').text('GAMING SESSION INVOICE', { align: 'center', characterSpacing: 1 });
      rule();

      row('Invoice', invoice.invoice_number, true);
      row('Date', formatBusinessDateTime(invoice.created_at));
      rule();

      row('Customer', invoice.customer_name);
      row('Phone', invoice.customer_phone);
      if (invoice.customer_email) row('Email', invoice.customer_email);
      rule();

      if (invoice.kind === 'MEMBERSHIP') {
        // Membership package sale
        row('Package', invoice.membership_name ?? 'Membership');
        row('Play time', formatDuration(invoice.membership_minutes_total ?? 0));
        if (invoice.membership_expires_at) row('Valid until', formatBusinessDateTime(invoice.membership_expires_at));
      } else {
        // Gaming session
        row('Console', `${invoice.console_number} (${invoice.console_type})`);
        if (invoice.start_datetime) row('Start', formatBusinessDateTime(invoice.start_datetime));
        const end = invoice.actual_end_datetime ?? invoice.end_datetime;
        if (end) row('End', formatBusinessDateTime(end));
        row('Duration', formatDuration(invoice.duration_minutes ?? 0));
        if (invoice.membership_minutes) {
          row(`Membership (${invoice.membership_name ?? 'package'})`, `- ${formatDuration(invoice.membership_minutes)}`);
        }
        row('Rate', `${money(invoice.hourly_rate ?? 0)} / hour`);
      }
      rule();

      row('Subtotal', money(invoice.subtotal));
      row('Discount', invoice.discount ? `- ${money(invoice.discount)}` : money(0));
      row('Tax', money(invoice.tax));
      rule();

      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#111111').text('TOTAL', left, y);
      doc.text(money(invoice.total), left, y, { width, align: 'right' });
      doc.moveDown(0.8);

      row('Payment', STATUS_LABEL[invoice.payment_status] ?? invoice.payment_status, true);
      if (invoice.amount_paid > 0) row('Paid', money(invoice.amount_paid));
      if (invoice.balance_due > 0 && invoice.payment_status !== 'CANCELLED') row('Balance due', money(invoice.balance_due), true);
      for (const p of invoice.payments) {
        row(`  ${p.payment_method} · ${formatBusinessDateTime(p.paid_at)}`, money(p.amount));
      }
      rule();

      doc.font('Helvetica').fontSize(8).fillColor('#777777').text('Thank you for playing with us!', { align: 'center' });
      doc.end();
    });
  },
};
