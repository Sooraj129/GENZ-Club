import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../api';
import { errorMessage } from '../api/client';
import { ConsoleTypeTag, PaymentStatusBadge, SessionStatusBadge } from '../components/StatusBadge';
import { Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '../components/ui';
import { useDebounce } from '../hooks/useDebounce';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { formatDate, formatDuration, formatTime, money } from '../utils/format';

const KEYS = ['from', 'to', 'customer', 'phone', 'console_id', 'console_type', 'status', 'payment_status'] as const;

export default function SessionHistoryPage() {
  const { filters, page, setFilter, setPage, reset, active } = useUrlFilters(KEYS);
  const customer = useDebounce(filters.customer, 300);
  const phone = useDebounce(filters.phone, 300);
  const consoles = useQuery({ queryKey: ['consoles'], queryFn: api.consoles.list });

  const query = { ...filters, customer, phone, page, pageSize: 20 };
  const q = useQuery({ queryKey: ['sessions', 'history', query], queryFn: () => api.sessions.list(query), placeholderData: keepPreviousData });

  return (
    <div>
      <PageHeader title="Session History" description="Every booking, with its outcome and payment." />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          <Field label="From" htmlFor="f-from">
            <Input id="f-from" type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
          </Field>
          <Field label="To" htmlFor="f-to">
            <Input id="f-to" type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
          </Field>
          <Field label="Customer" htmlFor="f-cust">
            <Input id="f-cust" placeholder="Name" value={filters.customer} onChange={(e) => setFilter('customer', e.target.value)} />
          </Field>
          <Field label="Phone" htmlFor="f-phone">
            <Input id="f-phone" inputMode="tel" value={filters.phone} onChange={(e) => setFilter('phone', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Console" htmlFor="f-console">
            <Select id="f-console" value={filters.console_id} onChange={(e) => setFilter('console_id', e.target.value)}>
              <option value="">All</option>
              {consoles.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.console_number}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type" htmlFor="f-type">
            <Select id="f-type" value={filters.console_type} onChange={(e) => setFilter('console_type', e.target.value)}>
              <option value="">All</option>
              <option value="PS5">PS5</option>
              <option value="PS4">PS4</option>
            </Select>
          </Field>
          <Field label="Status" htmlFor="f-status">
            <Select id="f-status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">All</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="ACTIVE">Playing</option>
              <option value="PAUSED">Paused</option>
              <option value="COMPLETED">Completed</option>
              <option value="EXPIRED">Time up</option>
              <option value="CANCELLED">Cancelled</option>
            </Select>
          </Field>
          <Field label="Payment" htmlFor="f-pay">
            <Select id="f-pay" value={filters.payment_status} onChange={(e) => setFilter('payment_status', e.target.value)}>
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
          <EmptyState icon={<History className="size-6" aria-hidden />} title="No sessions match" description={active ? 'Try widening the filters.' : undefined} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Customer</Th>
                  <Th>Console</Th>
                  <Th>Start</Th>
                  <Th>End</Th>
                  <Th>Duration</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Status</Th>
                  <Th>Payment</Th>
                  <Th>Invoice</Th>
                </tr>
              </thead>
              <tbody className={q.isPlaceholderData ? 'opacity-60' : undefined}>
                {q.data!.data.map((s) => {
                  const end = s.actual_end_datetime ?? s.end_datetime;
                  const minutes = s.duration_minutes ?? s.booked_minutes;
                  return (
                    <tr key={s.id}>
                      <Td>
                        <Link to={`/customers/${s.customer_id}`} className="font-medium hover:underline">
                          {s.customer_name}
                        </Link>
                        <p className="text-xs text-ink-muted">{s.customer_phone}</p>
                      </Td>
                      <Td>
                        <p className="font-medium">{s.console_number}</p>
                        <ConsoleTypeTag type={s.console_type} />
                      </Td>
                      <Td className="tabular whitespace-nowrap">
                        {formatDate(s.start_datetime)}
                        <p className="text-xs text-ink-muted">{formatTime(s.start_datetime)}</p>
                      </Td>
                      <Td className="tabular whitespace-nowrap">{formatTime(end)}</Td>
                      <Td className="whitespace-nowrap">{formatDuration(minutes)}</Td>
                      <Td className="tabular text-right">
                        {s.final_amount !== null ? money(s.final_amount) : <span className="text-ink-muted">~{money(s.estimated_amount)}</span>}
                      </Td>
                      <Td>
                        <SessionStatusBadge status={s.status} />
                      </Td>
                      <Td>
                        <PaymentStatusBadge status={s.payment_status} />
                      </Td>
                      <Td>
                        {s.invoice_id ? (
                          <Link to={`/invoices/${s.invoice_id}`} className="tabular text-brand-600 hover:underline">
                            {s.invoice_number}
                          </Link>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={q.data!.meta.page} totalPages={q.data!.meta.totalPages} total={q.data!.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
