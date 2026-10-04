import { query, SQL_TZ } from '../config/db.js';
import { consoleRepository } from '../repositories/consoleRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { addDays, businessDate, now, startOfBusinessDay } from '../utils/time.js';

export type ReportGrouping = 'day' | 'week' | 'month';

interface DailyRow {
  date: string;
  sessions: number;
  revenue: number;
  ps4_revenue: number;
  ps5_revenue: number;
  membership_revenue: number;
  collected: number;
  played_minutes: number;
  finished_sessions: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

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
       (SELECT COALESCE(sum(total), 0) FROM inv WHERE inv.day = days.day AND console_type = 'PS4') AS ps4_revenue,
       (SELECT COALESCE(sum(total), 0) FROM inv WHERE inv.day = days.day AND console_type = 'PS5') AS ps5_revenue,
       (SELECT COALESCE(sum(total), 0) FROM inv WHERE inv.day = days.day AND membership_id IS NOT NULL) AS membership_revenue,
       (SELECT COALESCE(sum(amount), 0) FROM pay WHERE pay.day = days.day) AS collected,
       (SELECT COALESCE(sum(duration_minutes), 0) FROM ses WHERE ses.day = days.day AND status IN ('COMPLETED', 'EXPIRED')) AS played_minutes,
       (SELECT count(*) FROM ses WHERE ses.day = days.day AND status IN ('COMPLETED', 'EXPIRED')) AS finished_sessions
     FROM days ORDER BY days.day`,
    [from, to, fromTs, toTs],
  );
  return rows;
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
    return rows.map((r) => ({ date: r.date, revenue: r.revenue, ps4_revenue: r.ps4_revenue, ps5_revenue: r.ps5_revenue, membership_revenue: r.membership_revenue, sessions: r.sessions }));
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
      const b = buckets.get(key) ?? { date: key, sessions: 0, revenue: 0, ps4_revenue: 0, ps5_revenue: 0, membership_revenue: 0, collected: 0, played_minutes: 0, finished_sessions: 0 };
      b.sessions += row.sessions;
      b.revenue = round2(b.revenue + row.revenue);
      b.ps4_revenue = round2(b.ps4_revenue + row.ps4_revenue);
      b.ps5_revenue = round2(b.ps5_revenue + row.ps5_revenue);
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
       LEFT JOIN sessions s ON s.console_id = co.id AND s.status IN ('COMPLETED', 'EXPIRED')
            AND s.start_datetime >= $1 AND s.start_datetime < $2
       LEFT JOIN invoices i ON i.session_id = s.id
       GROUP BY co.id ORDER BY co.console_type DESC, co.console_number`,
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
        ps4_revenue: round2(t.ps4_revenue + r.ps4_revenue),
        ps5_revenue: round2(t.ps5_revenue + r.ps5_revenue),
        membership_revenue: round2(t.membership_revenue + r.membership_revenue),
        collected: round2(t.collected + r.collected),
        played_minutes: t.played_minutes + r.played_minutes,
        finished_sessions: t.finished_sessions + r.finished_sessions,
      }),
      { sessions: 0, revenue: 0, ps4_revenue: 0, ps5_revenue: 0, membership_revenue: 0, collected: 0, played_minutes: 0, finished_sessions: 0 },
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
