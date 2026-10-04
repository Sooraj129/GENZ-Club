import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { api } from '../api';
import { errorMessage } from '../api/client';
import { ChartCard, Legend, RevenueByTypeChart, SERIES_COLORS, SessionsChart, UtilizationChart } from '../components/charts';
import { Card, ErrorState, Field, Input, PageHeader, Select, Spinner, StatCard, Table, Td, Th } from '../components/ui';
import { addDaysYmd, businessParts, formatDayLabel, formatDuration, money } from '../utils/format';
import { serverNow } from '../utils/serverClock';

type Preset = 'today' | 'yesterday' | '7d' | 'month' | 'custom';
const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
  { id: 'custom', label: 'Custom' },
];

function rangeFor(preset: Preset, today: string): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDaysYmd(today, -1), to: addDaysYmd(today, -1) };
    case '7d':
      return { from: addDaysYmd(today, -6), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    default:
      return { from: addDaysYmd(today, -29), to: today };
  }
}

export default function ReportsPage() {
  const today = useMemo(() => businessParts(new Date(serverNow())).date, []);
  const [preset, setPreset] = useState<Preset>('7d');
  const [custom, setCustom] = useState(() => rangeFor('custom', today));
  const [group, setGroup] = useState<'day' | 'week' | 'month'>('day');
  const range = preset === 'custom' ? custom : rangeFor(preset, today);
  const customValid = custom.from && custom.to && custom.from <= custom.to;

  const q = useQuery({
    queryKey: ['reports', range, group],
    queryFn: () => api.dashboard.report({ ...range, group }),
    enabled: preset !== 'custom' || Boolean(customValid),
  });
  const r = q.data;

  return (
    <div>
      <PageHeader title="Reports" description="Revenue is counted when an invoice is issued; collected is cash received." />

      {/* Filters in one row above the charts */}
      <Card className="mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="inline-flex flex-wrap rounded-lg border border-hairline p-0.5" role="group" aria-label="Date range">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              aria-pressed={preset === p.id}
              onClick={() => setPreset(p.id)}
              className={clsx('rounded-md px-3 py-1.5 text-sm', preset === p.id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-plane')}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <>
            <Field label="From" htmlFor="r-from">
              <Input id="r-from" type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            </Field>
            <Field label="To" htmlFor="r-to">
              <Input id="r-to" type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </Field>
          </>
        )}
        <div className="ml-auto w-36">
          <Field label="Group by" htmlFor="r-group">
            <Select id="r-group" value={group} onChange={(e) => setGroup(e.target.value as typeof group)}>
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </Select>
          </Field>
        </div>
      </Card>

      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !r ? (
        <p className="text-sm text-ink-muted">Choose a valid date range.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Revenue" value={money(r.summary.revenue)} sub={`${money(r.summary.collected)} collected`} />
            <StatCard label="Sessions" value={r.summary.sessions} />
            <StatCard label="PS5 revenue" value={money(r.summary.ps5_revenue)} />
            <StatCard label="PS4 revenue" value={money(r.summary.ps4_revenue)} sub={r.summary.membership_revenue ? `+ ${money(r.summary.membership_revenue)} memberships sold` : undefined} />
            <StatCard label="Avg. session" value={formatDuration(r.summary.avg_duration_minutes)} />
            <StatCard label="Pending payments" value={money(r.summary.pending_payments)} sub={`Utilization ${r.summary.utilization_percent}%`} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ChartCard
              title="Revenue by date"
              subtitle="PS5 vs PS4"
              legend={<Legend items={[{ label: 'PS5', color: SERIES_COLORS.ps5 }, { label: 'PS4', color: SERIES_COLORS.ps4 }]} />}
            >
              <RevenueByTypeChart data={r.series} group={group} />
            </ChartCard>
            <ChartCard title="Sessions per period">
              <SessionsChart data={r.series} group={group} />
            </ChartCard>
            <ChartCard title="Console utilization" subtitle="Share of the period each console was in play">
              <UtilizationChart data={r.consoles} height={Math.max(180, r.consoles.length * 36)} />
            </ChartCard>
            <ChartCard title="Payment methods">
              {r.payment_methods.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-muted">No payments in this period.</p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {r.payment_methods.map((m) => {
                    const share = r.summary.collected ? (m.amount / r.summary.collected) * 100 : 0;
                    return (
                      <li key={m.payment_method} className="py-3">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium text-ink">{m.payment_method}</span>
                          <span className="tabular text-ink">
                            {money(m.amount)} <span className="text-ink-muted">· {m.count} payments</span>
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/5">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${share}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ChartCard>
          </div>

          {/* Table view of the same data (accessibility + exact figures) */}
          <Card className="mt-6">
            <h2 className="px-4 pt-4 text-sm font-semibold text-ink">Breakdown</h2>
            <div className="mt-2">
              <Table>
                <thead>
                  <tr>
                    <Th>{group === 'day' ? 'Date' : group === 'week' ? 'Week of' : 'Month'}</Th>
                    <Th className="text-right">Sessions</Th>
                    <Th className="text-right">PS5</Th>
                    <Th className="text-right">PS4</Th>
                    <Th className="text-right">Revenue</Th>
                    <Th className="text-right">Collected</Th>
                    <Th className="text-right">Avg. duration</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.series.map((row) => (
                    <tr key={row.date}>
                      <Td className="tabular">{group === 'month' ? row.date.slice(0, 7) : formatDayLabel(row.date)}</Td>
                      <Td className="tabular text-right">{row.sessions}</Td>
                      <Td className="tabular text-right">{money(row.ps5_revenue)}</Td>
                      <Td className="tabular text-right">{money(row.ps4_revenue)}</Td>
                      <Td className="tabular text-right font-medium">{money(row.revenue)}</Td>
                      <Td className="tabular text-right">{money(row.collected)}</Td>
                      <Td className="tabular text-right">{row.avg_duration_minutes ? formatDuration(row.avg_duration_minutes) : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
