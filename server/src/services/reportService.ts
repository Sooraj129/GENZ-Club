import { query, SQL_TZ } from '../config/db.js';
import { consoleRepository } from '../repositories/consoleRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { CONSOLE_TYPES, type ConsoleType } from '../types/index.js';
import { addDays, businessDate, now, startOfBusinessDay } from '../utils/time.js';

export type ReportGrouping = 'day' | 'week' | 'month';

interface DailyRow {
  date: string;
  sessions: number;
  revenue: number;
  /** Session revenue per console type, e.g. { PS5: 840, PS4: 240, STEERING: 0, VR: 400 }. */
  by_type: Record<ConsoleType, number>;
  membership_revenue: number;
  collected: number;
  played_minutes: number;
  finished_sessions: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** { PS5: 0, PS4: 0, STEERING: 0, VR: 0 } */
const zeroByType = () => Object.fromEntries(CONSOLE_TYPES.map((t) => [t, 0])) as Record<ConsoleType, number>;

/** Adds b's per-type amounts into a (types missing from b count as 0). */
function addByType(a: Record<ConsoleType, number>, b: Partial<Record<ConsoleType, number>>) {
  for (const t of CONSOLE_TYPES) a[t] = round2(a[t] + Number(b[t] ?? 0));
  return a;
}

/** Monday of the ISO week containing `date`. */
function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  return addDays(date, -offset);
}

async function dailySeries(from: string, to: string): Promise<DailyRow[]> {
  const fromTs = startOfBusinessDay(from);
  const toTs = startOfBusinessDay(addDays(to, 1));
  const { rows } = await query<DailyRow>(
    `WITH days AS (
       SELECT d::date AS day FROM generate_series($1::date, $2::date, interval '1 day') d
     ),
     inv AS (
       -- console_type is NULL for membership-sale invoices
       SELECT (i.created_at AT TIME ZONE ${SQL_TZ})::date AS day, co.console_type, i.membership_id, i.total
       FROM invoices i
       LEFT JOIN sessions s ON s.id = i.session_id
       LEFT JOIN consoles co ON co.id = s.console_id
       WHERE i.payment_status <> 'CANCELLED' AND i.created_at >= $3 AND i.created_at < $4
     ),
     ses AS (
       SELECT (s.start_datetime AT TIME ZONE ${SQL_TZ})::date AS day, s.status, s.duration_minutes
       FROM sessions s
       WHERE s.status <> 'CANCELLED' AND s.start_datetime >= $3 AND s.start_datetime < $4
     ),
     pay AS (
       SELECT (p.paid_at AT TIME ZONE ${SQL_TZ})::date AS day, p.amount
       FROM payments p WHERE p.paid_at >= $3 AND p.paid_at < $4
     )
     SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
       (SELECT count(*) FROM ses WHERE ses.day = days.day) AS sessions,
       (SELECT COALESCE(sum(total), 0) FROM inv WHERE inv.day = days.day) AS revenue,
       (SELECT COALESCE(json_object_agg(t.console_type, t.amount), '{}'::json)
          FROM (SELECT console_type, sum(total) AS amount FROM inv
                WHERE inv.day = days.day AND console_type IS NOT NULL GROUP BY console_type) t) AS by_type,
       (SELECT COALESCE(sum(total), 0) FROM inv WHERE inv.day = days.day AND membership_id IS NOT NULL) AS membership_revenue,
       (SELECT COALESCE(sum(amount), 0) FROM pay WHERE pay.day = days.day) AS collected,
       (SELECT COALESCE(sum(duration_minutes), 0) FROM ses WHERE ses.day = days.day AND status IN ('COMPLETED', 'EXPIRED')) AS played_minutes,
       (SELECT count(*) FROM ses WHERE ses.day = days.day AND status IN ('COMPLETED', 'EXPIRED')) AS finished_sessions
     FROM days ORDER BY days.day`,
    [from, to, fromTs, toTs],
  );
  // Make sure every console type is present (0 when nothing was played).
  return rows.map((r) => ({ ...r, by_type: addByType(zeroByType(), r.by_type ?? {}) }));
}

export const reportService = {
  async dashboardSummary() {
    const today = businessDate(now());
    const dayStart = startOfBusinessDay(today);
    const dayEnd = startOfBusinessDay(addDays(today, 1));

    const { rows } = await query(
      `SELECT
         (SELECT COALESCE(sum(total), 0) FROM invoices
            WHERE payment_status <> 'CANCELLED' AND created_at >= $1 AND created_at < $2) AS today_revenue,
         (SELECT COALESCE(sum(amount), 0) FROM payments WHERE paid_at >= $1 AND paid_at < $2) AS today_collected,
         (SELECT count(*) FROM sessions WHERE status = 'ACTIVE') AS active_sessions,
         (SELECT count(*) FROM sessions WHERE status = 'SCHEDULED') AS upcoming_sessions,
         (SELECT count(*) FROM consoles WHERE status = 'AVAILABLE') AS available_consoles,
         (SELECT count(*) FROM consoles WHERE status <> 'DISABLED') AS total_consoles,
         (SELECT count(*) FROM sessions
            WHERE status <> 'CANCELLED' AND start_datetime >= $1 AND start_datetime < $2) AS today_sessions,
         (SELECT COALESCE(sum(i.total - COALESCE(p.paid, 0)), 0)
            FROM invoices i
            LEFT JOIN (SELECT invoice_id, sum(amount) AS paid FROM payments GROUP BY invoice_id) p ON p.invoice_id = i.id
            WHERE i.payment_status IN ('PENDING', 'PARTIALLY_PAID')) AS pending_amount,
         (SELECT count(*) FROM invoices WHERE payment_status IN ('PENDING', 'PARTIALLY_PAID')) AS pending_invoices`,
      [dayStart, dayEnd],
    );
    const [consoles, active, upcoming] = await Promise.all([
      consoleRepository.list(),
      sessionRepository.listActive(),
      sessionRepository.listUpcoming(5),
    ]);
    return { date: today, ...rows[0], consoles, active_sessions_list: active, upcoming_sessions_list: upcoming };
  },

  async revenueSeries(days: number) {
    const to = businessDate(now());
    const from = addDays(to, -(days - 1));
    const rows = await dailySeries(from, to);
    return rows.map((r) => ({ date: r.date, revenue: r.revenue, by_type: r.by_type, membership_revenue: r.membership_revenue, sessions: r.sessions }));
  },

  async report(from: string, to: string, group: ReportGrouping) {
    const fromTs = startOfBusinessDay(from);
    const toTs = startOfBusinessDay(addDays(to, 1));
    const daily = await dailySeries(from, to);

    // Roll days up into the requested buckets.
    const bucketOf = (d: string) => (group === 'day' ? d : group === 'week' ? weekStart(d) : `${d.slice(0, 7)}-01`);
    const buckets = new Map<string, DailyRow>();
    for (const row of daily) {
      const key = bucketOf(row.date);
      const b = buckets.get(key) ?? { date: key, sessions: 0, revenue: 0, by_type: zeroByType(), membership_revenue: 0, collected: 0, played_minutes: 0, finished_sessions: 0 };
      b.sessions += row.sessions;
      b.revenue = round2(b.revenue + row.revenue);
      addByType(b.by_type, row.by_type);
      b.membership_revenue = round2(b.membership_revenue + row.membership_revenue);
      b.collected = round2(b.collected + row.collected);
      b.played_minutes += row.played_minutes;
      b.finished_sessions += row.finished_sessions;
      buckets.set(key, b);
    }
    const series = [...buckets.values()].map((b) => ({
      ...b,
      avg_duration_minutes: b.finished_sessions ? Math.round(b.played_minutes / b.finished_sessions) : 0,
    }));

    const rangeMinutes = (toTs.getTime() - fromTs.getTime()) / 60_000;
    const { rows: consoles } = await query(
      `SELECT co.id, co.console_number, co.console_type,
              count(s.id) AS sessions,
              COALESCE(sum(s.duration_minutes), 0) AS played_minutes,
              COALESCE(sum(i.total) FILTER (WHERE i.payment_status <> 'CANCELLED'), 0) AS revenue
       FROM consoles co
       JOIN pricing p ON p.console_type = co.console_type
       LEFT JOIN sessions s ON s.console_id = co.id AND s.status IN ('COMPLETED', 'EXPIRED')
            AND s.start_datetime >= $1 AND s.start_datetime < $2
       LEFT JOIN invoices i ON i.session_id = s.id
       GROUP BY co.id, p.sort_order
       -- out-of-service consoles only appear if they were played in this period
       HAVING co.status <> 'DISABLED' OR count(s.id) > 0
       ORDER BY p.sort_order, co.console_number`,
      [fromTs, toTs],
    );
    const { rows: methods } = await query(
      `SELECT payment_method, count(*) AS count, COALESCE(sum(amount), 0) AS amount
       FROM payments WHERE paid_at >= $1 AND paid_at < $2 GROUP BY payment_method ORDER BY payment_method`,
      [fromTs, toTs],
    );
    const { rows: pending } = await query(
      `SELECT COALESCE(sum(i.total - COALESCE((SELECT sum(amount) FROM payments p WHERE p.invoice_id = i.id), 0)), 0) AS pending
       FROM invoices i
       WHERE i.payment_status IN ('PENDING', 'PARTIALLY_PAID') AND i.created_at >= $1 AND i.created_at < $2`,
      [fromTs, toTs],
    );

    const totals = daily.reduce(
      (t, r) => ({
        sessions: t.sessions + r.sessions,
        revenue: round2(t.revenue + r.revenue),
        by_type: addByType(t.by_type, r.by_type),
        membership_revenue: round2(t.membership_revenue + r.membership_revenue),
        collected: round2(t.collected + r.collected),
        played_minutes: t.played_minutes + r.played_minutes,
        finished_sessions: t.finished_sessions + r.finished_sessions,
      }),
      { sessions: 0, revenue: 0, by_type: zeroByType(), membership_revenue: 0, collected: 0, played_minutes: 0, finished_sessions: 0 },
    );
    const consoleRows = consoles.map((c) => ({
      ...c,
      utilization_percent: rangeMinutes ? round2((c.played_minutes / rangeMinutes) * 100) : 0,
    }));

    return {
      from,
      to,
      group,
      summary: {
        ...totals,
        pending_payments: pending[0].pending,
        avg_duration_minutes: totals.finished_sessions ? Math.round(totals.played_minutes / totals.finished_sessions) : 0,
        utilization_percent: consoleRows.length
          ? round2(consoleRows.reduce((s, c) => s + c.utilization_percent, 0) / consoleRows.length)
          : 0,
      },
      series,
      consoles: consoleRows,
      payment_methods: methods,
    };
  },
};
