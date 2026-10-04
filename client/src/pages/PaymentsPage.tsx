import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { errorMessage } from '../api/client';
import { PaymentDialog, type PayableInvoice } from '../components/PaymentDialog';
import { PaymentStatusBadge } from '../components/StatusBadge';
import { Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '../components/ui';
import { useDebounce } from '../hooks/useDebounce';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { formatDateTime, money, titleCase } from '../utils/format';

const KEYS = ['search', 'from', 'to', 'method'] as const;

export default function PaymentsPage() {
  const { filters, page, setFilter, setPage, reset, active } = useUrlFilters(KEYS);
  const search = useDebounce(filters.search, 300);
  const [paying, setPaying] = useState<PayableInvoice | null>(null);

  const outstanding = useQuery({
    queryKey: ['invoices', 'outstanding'],
    queryFn: async () => {
      const [pending, partial] = await Promise.all([
        api.invoices.list({ payment_status: 'PENDING', pageSize: 50 }),
        api.invoices.list({ payment_status: 'PARTIALLY_PAID', pageSize: 50 }),
      ]);
      return [...partial.data, ...pending.data];
    },
  });
  const query = { ...filters, search, page, pageSize: 20 };
  const q = useQuery({ queryKey: ['payments', query], queryFn: () => api.payments.list(query), placeholderData: keepPreviousData });

  return (
    <div>
      <PageHeader title="Payments" description="Collect outstanding balances and review payments received." />

      <h2 className="mb-3 text-sm font-semibold text-ink">Awaiting payment</h2>
      <Card className="mb-8">
        {outstanding.isLoading ? (
          <Spinner />
        ) : outstanding.isError ? (
          <ErrorState message={errorMessage(outstanding.error)} />
        ) : outstanding.data!.length === 0 ? (
          <EmptyState title="All settled" description="No invoices are waiting for payment." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Customer</Th>
                <Th>Date</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Balance</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {outstanding.data!.map((inv) => (
                <tr key={inv.id}>
                  <Td>
                    <Link to={`/invoices/${inv.id}`} className="tabular text-brand-600 hover:underline">
                      {inv.invoice_number}
                    </Link>
                  </Td>
                  <Td>
                    <p className="font-medium">{inv.customer_name}</p>
                    <p className="text-xs text-ink-muted">{inv.customer_phone}</p>
                  </Td>
                  <Td className="tabular whitespace-nowrap">{formatDateTime(inv.created_at)}</Td>
                  <Td className="tabular text-right">{money(inv.total)}</Td>
                  <Td className="tabular text-right font-medium">{money(inv.total - inv.amount_paid)}</Td>
                  <Td>
                    <PaymentStatusBadge status={inv.payment_status} />
                  </Td>
                  <Td className="text-right">
                    <Button size="sm" onClick={() => setPaying(inv)}>
                      Mark as Paid
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <h2 className="mb-3 text-sm font-semibold text-ink">Payments received</h2>
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Search" htmlFor="p-search">
            <Input id="p-search" placeholder="Invoice, name, phone" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
          </Field>
          <Field label="From" htmlFor="p-from">
            <Input id="p-from" type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
          </Field>
          <Field label="To" htmlFor="p-to">
            <Input id="p-to" type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
          </Field>
          <Field label="Method" htmlFor="p-method">
            <Select id="p-method" value={filters.method} onChange={(e) => setFilter('method', e.target.value)}>
              <option value="">All</option>
              <option value="CASH">Cash</option>
              <option value="UPI">UPI</option>
              <option value="CARD">Card</option>
            </Select>
          </Field>
        </div>
        {active && (
          <Button variant="ghost" size="sm" className="mt-3" onClick={reset}>
            Clear filters
          </Button>
        )}
      </Card>
      <Card>
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : q.data!.data.length === 0 ? (
          <EmptyState icon={<CreditCard className="size-6" aria-hidden />} title="No payments found" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Paid at</Th>
                  <Th>Invoice</Th>
                  <Th>Customer</Th>
                  <Th>Method</Th>
                  <Th>Reference</Th>
                  <Th>Processed by</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </thead>
              <tbody className={q.isPlaceholderData ? 'opacity-60' : undefined}>
                {q.data!.data.map((p) => (
                  <tr key={p.id}>
                    <Td className="tabular whitespace-nowrap">{formatDateTime(p.paid_at)}</Td>
                    <Td>
                      <Link to={`/invoices/${p.invoice_id}`} className="tabular text-brand-600 hover:underline">
                        {p.invoice_number}
                      </Link>
                    </Td>
                    <Td>{p.customer_name}</Td>
                    <Td>{p.payment_method === 'UPI' ? 'UPI' : titleCase(p.payment_method)}</Td>
                    <Td className="text-ink-2">{p.reference ?? '—'}</Td>
                    <Td className="text-ink-2">{p.processed_by_name ?? '—'}</Td>
                    <Td className="tabular text-right font-medium">{money(p.amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="flex flex-wrap items-center justify-between border-t border-hairline">
              <p className="px-4 py-3 text-sm text-ink-2">
                Total collected (filtered): <span className="tabular font-medium text-ink">{money(q.data!.meta.totalAmount)}</span>
              </p>
              <Pagination page={q.data!.meta.page} totalPages={q.data!.meta.totalPages} total={q.data!.meta.total} onPage={setPage} />
            </div>
          </>
        )}
      </Card>
      <PaymentDialog invoice={paying} onClose={() => setPaying(null)} />
    </div>
  );
}
