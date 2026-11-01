import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { api } from '../api';
import { errorMessage } from '../api/client';
import { ChartCard, RevenueByTypeChart, SessionsChart, TypeLegend, typesWithRevenue, UtilizationChart } from '../components/charts';
import { ConsoleTypeTag } from '../components/StatusBadge';
import { CONSOLE_TYPE_META, CONSOLE_TYPES } from '../utils/consoleTypes';
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
  // Console types that earned money in this period (each keeps its fixed colour).
  const chartTypes = r ? typesWithRevenue(r.series) : CONSOLE_TYPES;

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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Revenue" value={money(r.summary.revenue)} sub={`${money(r.summary.collected)} collected`} />
            <StatCard label="Sessions" value={r.summary.sessions} />
            <StatCard label="Avg. session" value={formatDuration(r.summary.avg_duration_minutes)} />
            <StatCard label="Pending payments" value={money(r.summary.pending_payments)} sub={`Utilization ${r.summary.utilization_percent}%`} />
          </div>

          {/* Revenue per console type (+ membership sales) */}
          <Card className="mt-3 p-4">
            <p className="mb-3 text-sm font-medium text-ink-2">Revenue by console type</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {CONSOLE_TYPES.map((t) => (
                <div key={t} className="rounded-xl bg-plane px-3 py-2.5">
                  <ConsoleTypeTag type={t} />
                  <p className="mt-1 text-lg font-semibold tabular text-ink">{money(r.summary.by_type[t])}</p>
                </div>
              ))}
              <div className="rounded-xl bg-violet-50 px-3 py-2.5">
                <p className="text-xs font-medium text-violet-700">Memberships sold</p>
                <p className="mt-1 text-lg font-semibold tabular text-ink">{money(r.summary.membership_revenue)}</p>
              </div>
            </div>
          </Card>

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ChartCard
              title="Revenue by date"
              subtitle="Session revenue by console type"
              legend={<TypeLegend types={chartTypes} />}
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
                    {chartTypes.map((t) => (
                      <Th key={t} className="text-right">
                        {CONSOLE_TYPE_META[t].label}
                      </Th>
                    ))}
                    <Th className="text-right">Memberships</Th>
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
                      {chartTypes.map((t) => (
                        <Td key={t} className="tabular text-right">
                          {money(row.by_type[t])}
                        </Td>
                      ))}
                      <Td className="tabular text-right">{money(row.membership_revenue)}</Td>
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
