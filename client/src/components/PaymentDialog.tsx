import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banknote, CreditCard, Smartphone } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import { errorMessage } from '../api/client';
import type { InvoiceDetail, PaymentMethod } from '../types';
import { money } from '../utils/format';
import { uniqueKey } from '../utils/id';
import { Button, Field, Input, KeyValue, Modal } from './ui';

export interface PayableInvoice {
  id: string;
  invoice_number: string;
  customer_name: string;
  total: number;
  amount_paid: number;
}

const METHODS: Array<{ value: PaymentMethod; label: string; icon: typeof Banknote }> = [
  { value: 'CASH', label: 'Cash', icon: Banknote },
  { value: 'UPI', label: 'UPI', icon: Smartphone },
  { value: 'CARD', label: 'Card', icon: CreditCard },
];

export function PaymentDialog({ invoice, onClose }: { invoice: PayableInvoice | null; onClose: () => void }) {
  const qc = useQueryClient();
  const balance = invoice ? Math.round((invoice.total - invoice.amount_paid) * 100) / 100 : 0;
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [reference, setReference] = useState('');
  // One key per dialog opening: double-clicks and retries can't create two payments.
  const idempotencyKey = useMemo(() => (invoice ? uniqueKey() : ''), [invoice]);

  useEffect(() => {
    if (invoice) {
      setAmount(String(balance));
      setMethod('CASH');
      setReference('');
    }
  }, [invoice, balance]);

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0 && value <= balance + 1e-9;

  const pay = useMutation({
    mutationFn: () =>
      api.payments.create({
        invoice_id: invoice!.id,
        amount: Math.round(value * 100) / 100,
        payment_method: method,
        reference: reference.trim() || undefined,
        idempotency_key: idempotencyKey,
      }),
    onSuccess: (r) => {
      toast.success(
        r.invoice.payment_status === 'PAID'
          ? `${r.invoice.invoice_number} paid in full`
          : `${money(r.payment.amount)} recorded · ${money(r.invoice.balance_due)} still due`,
      );
      // Show the server's updated invoice immediately, then refresh everything else.
      qc.setQueryData<InvoiceDetail>(['invoices', r.invoice.id], (old) => (old ? { ...old, ...r.invoice } : old));
      for (const key of ['invoices', 'payments', 'dashboard', 'sessions', 'customers', 'memberships']) qc.invalidateQueries({ queryKey: [key] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Modal
      open={!!invoice}
      onClose={onClose}
      title="Record payment"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pay.isPending} disabled={!valid} onClick={() => pay.mutate()}>
            Confirm Payment
          </Button>
        </>
      }
    >
      {invoice && (
        <div className="space-y-4">
          <div className="rounded-lg bg-plane px-3 py-2">
            <KeyValue label="Invoice" value={invoice.invoice_number} />
            <KeyValue label="Customer" value={invoice.customer_name} />
            <KeyValue label="Total" value={money(invoice.total)} />
            {invoice.amount_paid > 0 && <KeyValue label="Already paid" value={money(invoice.amount_paid)} />}
            <KeyValue label="Balance due" value={money(balance)} strong />
          </div>
          <Field label="Amount" htmlFor="pay-amount" error={amount && !valid ? `Enter an amount up to ${money(balance)}` : undefined} hint="Enter less than the balance for a partial payment">
            <Input id="pay-amount" type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!amount && !valid} />
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink">Payment Method</legend>
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map(({ value: v, label, icon: Icon }) => (
                <label
                  key={v}
                  className={
                    method === v
                      ? 'flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-brand-500 bg-brand-50 py-2.5 text-sm font-medium text-brand-700'
                      : 'flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-hairline py-2.5 text-sm hover:bg-plane'
                  }
                >
                  <input type="radio" name="method" value={v} checked={method === v} onChange={() => setMethod(v)} className="sr-only" />
                  <Icon className="size-5" aria-hidden />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          {method !== 'CASH' && (
            <Field label="Reference (optional)" htmlFor="pay-ref" hint="UPI transaction ID or card slip number">
              <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
}
