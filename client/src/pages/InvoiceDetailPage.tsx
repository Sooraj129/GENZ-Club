import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Download, Percent, Printer, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { api } from '../api';
import { errorMessage } from '../api/client';
import { PaymentDialog } from '../components/PaymentDialog';
import { PaymentStatusBadge } from '../components/StatusBadge';
import { Button, ErrorState, Field, Input, Modal, Spinner } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { formatDateTime, formatDuration, money, titleCase } from '../utils/format';

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <span className="text-ink-2">{label}</span>
      <span className={bold ? 'tabular font-semibold' : 'tabular'}>{value}</span>
    </div>
  );
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [paying, setPaying] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discount, setDiscount] = useState('');
  const q = useQuery({ queryKey: ['invoices', id], queryFn: () => api.invoices.get(id!) });

  const refresh = () => ['invoices', 'dashboard', 'sessions'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const applyDiscount = useMutation({
    mutationFn: () => api.invoices.discount(id!, Number(discount)),
    onSuccess: () => {
      toast.success('Discount applied');
      setDiscountOpen(false);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: () => api.invoices.cancel(id!),
    onSuccess: () => {
      toast.success('Invoice cancelled');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const inv = q.data!;
  const open = inv.payment_status === 'PENDING' || inv.payment_status === 'PARTIALLY_PAID';

  return (
    <div>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link to="/invoices" className="flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Invoices
        </Link>
        <div className="flex flex-wrap gap-2">
          {isAdmin && inv.payment_status === 'PENDING' && (
            <>
              <Button variant="secondary" icon={<Percent className="size-4" aria-hidden />} onClick={() => (setDiscount(String(inv.discount || '')), setDiscountOpen(true))}>
                Discount
              </Button>
              <Button variant="secondary" icon={<Ban className="size-4" aria-hidden />} loading={cancel.isPending} onClick={() => confirm('Cancel this invoice? This cannot be undone.') && cancel.mutate()}>
                Cancel invoice
              </Button>
            </>
          )}
          <Button variant="secondary" icon={<Printer className="size-4" aria-hidden />} onClick={() => window.print()}>
            Print
          </Button>
          <Button
            variant="secondary"
            icon={<Download className="size-4" aria-hidden />}
            onClick={() => api.invoices.downloadPdf(inv.id, inv.invoice_number).catch((e) => toast.error(errorMessage(e)))}
          >
            PDF
          </Button>
          {open && (
            <Button icon={<Wallet className="size-4" aria-hidden />} onClick={() => setPaying(true)}>
              Mark as Paid
            </Button>
          )}
        </div>
      </div>

      <article className="print-area mx-auto max-w-md rounded-xl border border-hairline bg-white p-8 font-mono text-sm text-ink shadow-sm">
        <header className="border-b-2 border-double border-ink pb-4 text-center">
          <h1 className="text-lg font-bold tracking-widest">{inv.business.business_name.toUpperCase()}</h1>
          {inv.business.business_address && <p className="mt-1 text-xs text-ink-2">{inv.business.business_address}</p>}
          {inv.business.business_phone && <p className="text-xs text-ink-2">Phone: {inv.business.business_phone}</p>}
        </header>

        <section className="border-b border-dashed border-ink/40 py-3">
          <Line label="Invoice" value={inv.invoice_number} bold />
          <Line label="Date" value={formatDateTime(inv.created_at)} />
        </section>
        <section className="border-b border-dashed border-ink/40 py-3">
          <Line label="Customer" value={inv.customer_name} />
          <Line label="Phone" value={inv.customer_phone} />
        </section>
        {inv.kind === 'MEMBERSHIP' ? (
          // Membership package sale
          <section className="border-b border-dashed border-ink/40 py-3">
            <Line label="Package" value={inv.membership_name ?? 'Membership'} />
            <Line label="Play time" value={formatDuration(inv.membership_minutes_total)} />
            <Line label="Valid until" value={formatDateTime(inv.membership_expires_at)} />
          </section>
        ) : (
          // Gaming session
          <section className="border-b border-dashed border-ink/40 py-3">
            <Line label="Console" value={`${inv.console_number} (${inv.console_type})`} />
            <Line label="Start" value={formatDateTime(inv.start_datetime)} />
            <Line label="End" value={formatDateTime(inv.actual_end_datetime ?? inv.end_datetime)} />
            <Line label="Duration" value={formatDuration(inv.duration_minutes)} />
            {!!inv.membership_minutes && (
              <Line label={`Membership (${inv.membership_name ?? 'package'})`} value={`− ${formatDuration(inv.membership_minutes)}`} />
            )}
            <Line label="Rate" value={`${money(inv.hourly_rate)}/hour`} />
          </section>
        )}
        <section className="border-b border-dashed border-ink/40 py-3">
          <Line label="Subtotal" value={money(inv.subtotal)} />
          <Line label="Discount" value={inv.discount ? `- ${money(inv.discount)}` : money(0)} />
          <Line label="Tax" value={money(inv.tax)} />
        </section>
        <section className="border-b-2 border-double border-ink py-3">
          <div className="flex justify-between text-base font-bold">
            <span>TOTAL</span>
            <span className="tabular">{money(inv.total)}</span>
          </div>
        </section>
        <section className="py-3">
          <div className="flex items-center justify-between py-1">
            <span className="text-ink-2">Payment</span>
            <span className="print:hidden">
              <PaymentStatusBadge status={inv.payment_status} />
            </span>
            <span className="hidden font-semibold print:inline">{titleCase(inv.payment_status)}</span>
          </div>
          {inv.amount_paid > 0 && <Line label="Paid" value={money(inv.amount_paid)} />}
          {open && inv.balance_due > 0 && <Line label="Balance due" value={money(inv.balance_due)} bold />}
          {inv.payments.map((p) => (
            <div key={p.id} className="flex justify-between py-0.5 text-xs text-ink-2">
              <span>
                {p.payment_method} · {formatDateTime(p.paid_at)}
                {p.reference ? ` · ${p.reference}` : ''}
              </span>
              <span className="tabular">{money(p.amount)}</span>
            </div>
          ))}
        </section>
        <footer className="border-t border-dashed border-ink/40 pt-3 text-center text-xs text-ink-2">Thank you for playing with us!</footer>
      </article>

      <PaymentDialog invoice={paying ? inv : null} onClose={() => setPaying(false)} />
      <Modal
        open={discountOpen}
        onClose={() => setDiscountOpen(false)}
        title="Apply discount"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDiscountOpen(false)}>
              Cancel
            </Button>
            <Button loading={applyDiscount.isPending} disabled={!(Number(discount) >= 0 && Number(discount) <= inv.subtotal)} onClick={() => applyDiscount.mutate()}>
              Apply
            </Button>
          </>
        }
      >
        <Field label="Discount amount (₹)" htmlFor="disc" hint={`Up to ${money(inv.subtotal)}. Only possible before any payment.`}>
          <Input id="disc" type="number" min={0} max={inv.subtotal} step="1" value={discount} onChange={(e) => setDiscount(e.target.value)} autoFocus />
        </Field>
      </Modal>
    </div>
  );
}
