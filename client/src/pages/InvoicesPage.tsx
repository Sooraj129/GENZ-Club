import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, Receipt, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { api } from '../api';
import { errorMessage } from '../api/client';
import { PaymentDialog, type PayableInvoice } from '../components/PaymentDialog';
import { PaymentStatusBadge } from '../components/StatusBadge';
import { Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '../components/ui';
import { useDebounce } from '../hooks/useDebounce';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { formatDateTime, money } from '../utils/format';

const KEYS = ['search', 'from', 'to', 'payment_status'] as const;

export default function InvoicesPage() {
  const { filters, page, setFilter, setPage, reset, active } = useUrlFilters(KEYS);
  const search = useDebounce(filters.search, 300);
  const [paying, setPaying] = useState<PayableInvoice | null>(null);
  const query = { ...filters, search, page, pageSize: 20 };
  const q = useQuery({ queryKey: ['invoices', 'list', query], queryFn: () => api.invoices.list(query), placeholderData: keepPreviousData });

  return (
    <div>
      <PageHeader title="Invoices" description="Generated automatically when a session finishes." />
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <Field label="Search" htmlFor="i-search">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
                <Input id="i-search" placeholder="Invoice no, name, phone" className="pl-9" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
              </div>
            </Field>
          </div>
          <Field label="From" htmlFor="i-from">
            <Input id="i-from" type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
          </Field>
          <Field label="To" htmlFor="i-to">
            <Input id="i-to" type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
          </Field>
          <Field label="Payment status" htmlFor="i-status">
            <Select id="i-status" value={filters.payment_status} onChange={(e) => setFilter('payment_status', e.target.value)}>
              <option value="">All</option>
              <option value="PENDING">Pending</option>
              <option value="PARTIALLY_PAID">Partially paid</option>
              <option value="PAID">Paid</option>
              <option value="CANCELLED">Cancelled</option>
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
          <EmptyState icon={<Receipt className="size-6" aria-hidden />} title="No invoices found" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Invoice</Th>
                  <Th>Date</Th>
                  <Th>Customer</Th>
                  <Th>For</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">Paid</Th>
                  <Th>Payment</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody className={q.isPlaceholderData ? 'opacity-60' : undefined}>
                {q.data!.data.map((inv) => (
                  <tr key={inv.id}>
                    <Td>
                      <Link to={`/invoices/${inv.id}`} className="tabular font-medium text-brand-600 hover:underline">
                        {inv.invoice_number}
                      </Link>
                    </Td>
                    <Td className="tabular whitespace-nowrap">{formatDateTime(inv.created_at)}</Td>
                    <Td>
                      <p className="font-medium">{inv.customer_name}</p>
                      <p className="text-xs text-ink-muted">{inv.customer_phone}</p>
                    </Td>
                    <Td>{inv.kind === 'MEMBERSHIP' ? <span className="text-violet-700">{inv.membership_name} (package)</span> : inv.console_number}</Td>
                    <Td className="tabular text-right font-medium">{money(inv.total)}</Td>
                    <Td className="tabular text-right">{money(inv.amount_paid)}</Td>
                    <Td>
                      <PaymentStatusBadge status={inv.payment_status} />
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        {(inv.payment_status === 'PENDING' || inv.payment_status === 'PARTIALLY_PAID') && (
                          <Button size="sm" onClick={() => setPaying(inv)}>
                            Mark as Paid
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Download ${inv.invoice_number} as PDF`}
                          icon={<Download className="size-4" aria-hidden />}
                          onClick={() => api.invoices.downloadPdf(inv.id, inv.invoice_number).catch((e) => toast.error(errorMessage(e)))}
                        />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="flex flex-wrap items-center justify-between border-t border-hairline">
              <p className="px-4 py-3 text-sm text-ink-2">
                Total of filtered invoices: <span className="tabular font-medium text-ink">{money(q.data!.meta.totalAmount)}</span>
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
