/**
 * Sell a membership package to a customer.
 * After the sale the payment dialog opens for the new invoice, so staff can
 * collect the money straight away (or close it and collect later).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import { errorMessage } from '../api/client';
import { useDebounce } from '../hooks/useDebounce';
import type { Customer } from '../types';
import { formatDuration, money } from '../utils/format';
import { PaymentDialog, type PayableInvoice } from './PaymentDialog';
import { Button, EmptyState, Input, Modal, Spinner } from './ui';

export function SellMembershipDialog({
  open,
  onClose,
  customer: fixedCustomer,
}: {
  open: boolean;
  onClose: () => void;
  /** Pre-selected customer (from the customer profile). */
  customer?: Pick<Customer, 'id' | 'name' | 'phone'> | null;
}) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Customer | null>(null);
  const [term, setTerm] = useState('');
  const [planId, setPlanId] = useState('');
  const [toPay, setToPay] = useState<PayableInvoice | null>(null);
  const debounced = useDebounce(term.trim(), 250);
  const customer = fixedCustomer ?? picked;

  const plans = useQuery({ queryKey: ['memberships', 'plans'], queryFn: () => api.memberships.plans(), enabled: open });
  const results = useQuery({
    queryKey: ['customers', 'search', debounced],
    queryFn: () => api.customers.search(debounced),
    enabled: open && !customer && debounced.length >= 2,
  });

  const reset = () => {
    setPicked(null);
    setTerm('');
    setPlanId('');
  };

  const sell = useMutation({
    mutationFn: () => api.memberships.sell(customer!.id, planId),
    onSuccess: ({ membership, invoice }) => {
      toast.success(`${membership.plan_name} sold to ${membership.customer_name} · Invoice ${invoice.invoice_number}`);
      for (const k of ['memberships', 'invoices', 'dashboard', 'customers']) qc.invalidateQueries({ queryKey: [k] });
      reset();
      onClose();
      // Collect payment right away.
      if (invoice.total > 0) {
        setToPay({ id: invoice.id, invoice_number: invoice.invoice_number, customer_name: membership.customer_name, total: invoice.total, amount_paid: 0 });
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <>
      <Modal
        open={open}
        onClose={() => (reset(), onClose())}
        title="Sell membership"
        footer={
          <>
            <Button variant="secondary" onClick={() => (reset(), onClose())}>
              Cancel
            </Button>
            <Button disabled={!customer || !planId} loading={sell.isPending} onClick={() => sell.mutate()}>
              Sell & create invoice
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {/* Customer */}
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Customer</p>
            {customer ? (
              <div className="flex items-center justify-between rounded-lg border border-brand-500/40 bg-brand-50 px-3 py-2">
                <span>
                  <span className="font-medium">{customer.name}</span> <span className="text-sm text-ink-2">· {customer.phone}</span>
                </span>
                {!fixedCustomer && (
                  <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
                    Change
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
                  <Input aria-label="Search customer" placeholder="Phone or name" className="pl-9" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
                </div>
                {results.data && results.data.length > 0 && (
                  <ul className="mt-2 max-h-48 divide-y divide-hairline overflow-y-auto rounded-lg border border-hairline">
                    {results.data.map((c) => (
                      <li key={c.id}>
                        <button className="w-full px-3 py-2 text-left text-sm hover:bg-plane" onClick={() => setPicked(c)}>
                          <span className="font-medium">{c.name}</span> <span className="text-ink-2">· {c.phone}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {results.data?.length === 0 && <p className="mt-2 text-sm text-ink-muted">No customer found — add them on the Customers page first.</p>}
              </>
            )}
          </div>

          {/* Plan */}
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Package</p>
            {plans.isLoading ? (
              <Spinner />
            ) : !plans.data?.length ? (
              <EmptyState title="No packages on sale" description="An admin can create packages on the Memberships page → Plans." />
            ) : (
              <div className="grid gap-2" role="radiogroup" aria-label="Package">
                {plans.data.map((p) => (
                  <button
                    key={p.id}
                    role="radio"
                    aria-checked={planId === p.id}
                    onClick={() => setPlanId(p.id)}
                    className={clsx(
                      'flex items-center justify-between rounded-xl border px-4 py-3 text-left',
                      planId === p.id ? 'border-2 border-brand-500 bg-brand-50' : 'border-hairline hover:bg-plane',
                    )}
                  >
                    <span>
                      <span className="block font-semibold text-ink">{p.name}</span>
                      <span className="block text-xs text-ink-2">
                        {formatDuration(p.minutes)} play · {p.console_type ?? 'any console'} · valid {p.validity_days} days
                      </span>
                    </span>
                    <span className="text-lg font-semibold tabular text-ink">{money(p.price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>
      <PaymentDialog invoice={toPay} onClose={() => setToPay(null)} />
    </>
  );
}
