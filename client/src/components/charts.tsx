import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDayLabel, money } from '../utils/format';

// Chart chrome from the validated reference palette. Series colours are fixed
// per entity: PS5 is always slot 1 (blue), PS4 always slot 2 (orange).
const C = {
  ps5: '#2a78d6',
  ps4: '#eb6834',
  single: '#2a78d6',
  grid: '#e1e0d9',
  axis: '#898781',
  surface: '#fcfcfb',
};

const axisProps = { stroke: C.axis, fontSize: 12, tickLine: false, axisLine: { stroke: '#c3c2b7' } } as const;
const compactMoney = (v: number) => (v >= 1000 ? `₹${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `₹${v}`);

function TooltipBox({ title, rows }: { title: string; rows: Array<{ label: string; value: string; color?: string }> }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-ink">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-4 text-ink-2">
          <span className="flex items-center gap-1.5">
            {r.color && <span className="size-2 rounded-sm" style={{ background: r.color }} aria-hidden />}
            {r.label}
          </span>
          <span className="tabular font-medium text-ink">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: i.color }} aria-hidden />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function ChartCard({ title, subtitle, legend, children }: { title: string; subtitle?: string; legend?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
        </div>
        {legend}
      </div>
      {children}
    </div>
  );
}

const labelFor = (d: string, group?: string) => (group === 'month' ? d.slice(0, 7) : group === 'week' ? `Wk of ${formatDayLabel(d)}` : formatDayLabel(d));

/** Revenue per period, stacked PS5 + PS4 (legend always shown for two series). */
export function RevenueByTypeChart({ data, group, height = 260 }: { data: Array<{ date: string; ps4_revenue: number; ps5_revenue: number; revenue: number }>; group?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="25%">
        <CartesianGrid vertical={false} stroke={C.grid} />
        <XAxis dataKey="date" tickFormatter={(d) => labelFor(d, group)} {...axisProps} minTickGap={12} />
        <YAxis tickFormatter={compactMoney} {...axisProps} axisLine={false} width={52} />
        <Tooltip
          cursor={{ fill: 'rgba(0,0,0,0.04)' }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox
                title={labelFor(String(label), group)}
                rows={[
                  { label: 'PS5', value: money(payload[0].payload.ps5_revenue), color: C.ps5 },
                  { label: 'PS4', value: money(payload[0].payload.ps4_revenue), color: C.ps4 },
                  { label: 'Total', value: money(payload[0].payload.revenue) },
                ]}
              />
            ) : null
          }
        />
        <Bar isAnimationActive={false} dataKey="ps5_revenue" stackId="r" fill={C.ps5} stroke={C.surface} strokeWidth={2} name="PS5" />
        <Bar isAnimationActive={false} dataKey="ps4_revenue" stackId="r" fill={C.ps4} stroke={C.surface} strokeWidth={2} radius={[4, 4, 0, 0]} name="PS4" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SessionsChart({ data, group, height = 240 }: { data: Array<{ date: string; sessions: number }>; group?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={C.grid} />
        <XAxis dataKey="date" tickFormatter={(d) => labelFor(d, group)} {...axisProps} minTickGap={12} />
        <YAxis allowDecimals={false} {...axisProps} axisLine={false} width={36} />
        <Tooltip
          cursor={{ stroke: C.axis, strokeDasharray: '3 3' }}
          content={({ active, payload, label }) =>
            active && payload?.length ? <TooltipBox title={labelFor(String(label), group)} rows={[{ label: 'Sessions', value: String(payload[0].value) }]} /> : null
          }
        />
        <Line type="linear" isAnimationActive={false} dataKey="sessions" stroke={C.single} strokeWidth={2} dot={{ r: 4, fill: C.single, stroke: C.surface, strokeWidth: 2 }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function UtilizationChart({ data, height = 240 }: { data: Array<{ console_number: string; console_type: 'PS4' | 'PS5'; utilization_percent: number; played_minutes: number }>; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid horizontal={false} stroke={C.grid} />
        <XAxis type="number" domain={[0, (max: number) => Math.max(10, Math.ceil(max / 10) * 10)]} tickFormatter={(v) => `${v}%`} {...axisProps} />
        <YAxis type="category" dataKey="console_number" {...axisProps} width={60} />
        <Tooltip
          cursor={{ fill: 'rgba(0,0,0,0.04)' }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipBox
                title={`${payload[0].payload.console_number} (${payload[0].payload.console_type})`}
                rows={[
                  { label: 'Utilization', value: `${payload[0].payload.utilization_percent}%` },
                  { label: 'Hours played', value: (payload[0].payload.played_minutes / 60).toFixed(1) },
                ]}
              />
            ) : null
          }
        />
        <Bar isAnimationActive={false} dataKey="utilization_percent" fill={C.single} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export const SERIES_COLORS = C;
