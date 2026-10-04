import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, Clock, Gamepad2, IndianRupee, Monitor, Wallet } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../api';
import { errorMessage } from '../api/client';
import { ChartCard, Legend, RevenueByTypeChart, SERIES_COLORS } from '../components/charts';
import { ConsoleStatusBadge, ConsoleTypeTag } from '../components/StatusBadge';
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatCard, Table, Td, Th } from '../components/ui';
import { useServerNow } from '../hooks/useServerNow';
import { formatCountdown, formatTime, money } from '../utils/format';

export default function DashboardPage() {
  const now = useServerNow();
  const summary = useQuery({ queryKey: ['dashboard', 'summary'], queryFn: api.dashboard.summary, refetchInterval: 60_000 });
  const revenue = useQuery({ queryKey: ['dashboard', 'revenue', 7], queryFn: () => api.dashboard.revenue(7) });

  if (summary.isLoading) return <Spinner />;
  if (summary.isError) return <ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} />;
  const s = summary.data!;
  // Disabled consoles are out of service permanently — keep them off the daily view.
  const consoles = s.consoles.filter((c) => c.status !== 'DISABLED');

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Today at a glance — updates live."
        actions={
          <Link to="/sessions/new">
            <Button icon={<CalendarPlus className="size-4" aria-hidden />}>New Session</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Today's Revenue" value={money(s.today_revenue)} sub={`${money(s.today_collected)} collected`} icon={<IndianRupee className="size-4" aria-hidden />} tone="indigo" />
        <StatCard label="Active Sessions" value={s.active_sessions} sub={`${s.upcoming_sessions} upcoming`} icon={<Gamepad2 className="size-4" aria-hidden />} tone="violet" />
        <StatCard label="Available Consoles" value={`${s.available_consoles} / ${s.total_consoles}`} icon={<Monitor className="size-4" aria-hidden />} tone="emerald" />
        <StatCard label="Today's Sessions" value={s.today_sessions} icon={<Clock className="size-4" aria-hidden />} tone="sky" />
        <StatCard
          label="Pending Payments"
          value={money(s.pending_amount)}
          sub={
            <Link to="/invoices?payment_status=PENDING" className="text-brand-600 hover:underline">
              {s.pending_invoices} invoice{s.pending_invoices === 1 ? '' : 's'} →
            </Link>
          }
          icon={<Wallet className="size-4" aria-hidden />}
          tone="amber"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-1">
          <h2 className="mb-3 text-sm font-semibold text-ink">Console overview</h2>
          {consoles.length === 0 ? (
            <EmptyState title="No consoles yet" />
          ) : (
            <ul className="divide-y divide-hairline">
              {consoles.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-ink">
                      {c.console_number} <ConsoleTypeTag type={c.console_type} />
                    </p>
                    <p className="truncate text-xs text-ink-muted">
                      {c.status === 'PLAYING' && c.current_customer_name
                        ? `${c.current_customer_name} · until ${formatTime(c.current_end_datetime)}`
                        : c.next_start_datetime
                          ? `Next booking ${formatTime(c.next_start_datetime)}`
                          : `${money(c.hourly_rate)}/hr`}
                    </p>
                  </div>
                  <ConsoleStatusBadge status={c.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-sm font-semibold text-ink">Active sessions</h2>
            <Link to="/sessions/active" className="text-sm text-brand-600 hover:underline">
              Manage →
            </Link>
          </div>
          {s.active_sessions_list.length === 0 ? (
            <EmptyState title="No active sessions" description="Consoles in use will show here with a live countdown." />
          ) : (
            <div className="mt-2">
              <Table>
                <thead>
                  <tr>
                    <Th>Customer</Th>
                    <Th>Console</Th>
                    <Th>Start</Th>
                    <Th>End</Th>
                    <Th>Remaining</Th>
                    <Th className="text-right">Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {s.active_sessions_list.map((a) => {
                    const left = +new Date(a.end_datetime) - now;
                    return (
                      <tr key={a.id}>
                        <Td className="font-medium">{a.customer_name}</Td>
                        <Td>{a.console_number}</Td>
                        <Td className="tabular">{formatTime(a.start_datetime)}</Td>
                        <Td className="tabular">{formatTime(a.end_datetime)}</Td>
                        <Td className={left <= 10 * 60_000 ? 'tabular font-medium text-warning-ink' : 'tabular'}>{left > 0 ? formatCountdown(left) : 'Time up'}</Td>
                        <Td className="tabular text-right">{money(a.estimated_amount)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <ChartCard
          title="Revenue — last 7 days"
          subtitle="Invoiced amount per day"
          legend={<Legend items={[{ label: 'PS5', color: SERIES_COLORS.ps5 }, { label: 'PS4', color: SERIES_COLORS.ps4 }]} />}
        >
          {revenue.isLoading ? <Spinner /> : revenue.isError ? <ErrorState message={errorMessage(revenue.error)} /> : <RevenueByTypeChart data={revenue.data!} />}
        </ChartCard>
      </div>
    </div>
  );
}
