import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BadgePercent, CalendarPlus, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { errorMessage } from '../api/client';
import { CustomerFormModal } from '../components/CustomerFormModal';
import { SellMembershipDialog } from '../components/SellMembershipDialog';
import { BalanceBar, MembershipStateBadge } from '../components/MembershipBits';
import { PaymentStatusBadge, SessionStatusBadge } from '../components/StatusBadge';
import { Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Spinner, StatCard, Table, Td, Th } from '../components/ui';
import { formatDate, formatDuration, formatTime, money } from '../utils/format';

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [selling, setSelling] = useState(false);
  const memberships = useQuery({ queryKey: ['memberships', 'customer', id], queryFn: () => api.memberships.forCustomer(id!) });
  const profile = useQuery({ queryKey: ['customers', id], queryFn: () => api.customers.get(id!) });
  const history = useQuery({
    queryKey: ['customers', id, 'history', page],
    queryFn: () => api.customers.history(id!, { page, pageSize: 10 }),
    placeholderData: keepPreviousData,
  });

  if (profile.isLoading) return <Spinner />;
  if (profile.isError) return <ErrorState message={errorMessage(profile.error)} onRetry={() => profile.refetch()} />;
  const c = profile.data!;

  return (
    <div>
      <PageHeader
        title={c.name}
        description={`${c.phone}${c.email ? ` · ${c.email}` : ''}`}
        actions={
          <>
            <Button variant="secondary" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="secondary" icon={<BadgePercent className="size-4" aria-hidden />} onClick={() => setSelling(true)}>
              Sell membership
            </Button>
            <Link to={`/sessions/new?customer=${c.id}`}>
              <Button icon={<CalendarPlus className="size-4" aria-hidden />}>New Session</Button>
            </Link>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Total Sessions" value={c.total_sessions} />
        <StatCard label="Total Spent" value={money(c.total_spent)} />
        <StatCard label="Last Visit" value={formatDate(c.last_visit)} />
      </div>
      {(memberships.data?.length ?? 0) > 0 && (
        <Card className="mb-6">
          <h2 className="px-4 pt-4 text-sm font-semibold text-ink">Memberships</h2>
          <ul className="divide-y divide-hairline">
            {memberships.data!.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="flex items-center gap-2 font-medium text-ink">
                    <BadgePercent className="size-4 text-violet-600" aria-hidden /> {m.plan_name} <MembershipStateBadge state={m.state} />
                  </p>
                  <p className="text-xs text-ink-muted">
                    {m.console_type ?? 'Any console'} · bought {formatDate(m.purchased_at)} · expires {formatDate(m.expires_at)}
                  </p>
                </div>
                <BalanceBar left={m.minutes_left} total={m.minutes_total} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <h2 className="px-4 pt-4 text-sm font-semibold text-ink">Session history</h2>
        {history.isLoading ? (
          <Spinner />
        ) : history.isError ? (
          <ErrorState message={errorMessage(history.error)} />
        ) : history.data!.data.length === 0 ? (
          <EmptyState title="No sessions yet" />
        ) : (
          <>
            <div className="mt-2">
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Console</Th>
                    <Th>Duration</Th>
                    <Th className="text-right">Amount</Th>
                    <Th>Status</Th>
                    <Th>Payment Status</Th>
                    <Th>Invoice</Th>
                  </tr>
                </thead>
                <tbody>
                  {history.data!.data.map((s) => (
                    <tr key={s.id}>
                      <Td className="tabular whitespace-nowrap">
                        {formatDate(s.start_datetime)}
                        <p className="text-xs text-ink-muted">{formatTime(s.start_datetime)}</p>
                      </Td>
                      <Td>
                        {s.console_number} <span className="text-xs text-ink-muted">{s.console_type}</span>
                      </Td>
                      <Td>{formatDuration(s.duration_minutes ?? s.booked_minutes)}</Td>
                      <Td className="tabular text-right">{money(s.final_amount ?? s.estimated_amount)}</Td>
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
                          '—'
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <Pagination page={history.data!.meta.page} totalPages={history.data!.meta.totalPages} total={history.data!.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      <CustomerFormModal open={editing} onClose={() => setEditing(false)} customer={c} />
      <SellMembershipDialog open={selling} onClose={() => setSelling(false)} customer={c} />
    </div>
  );
}
