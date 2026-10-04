/** All display uses the gaming center's timezone, regardless of the staff PC's settings. */
export const BUSINESS_TZ = 'Asia/Kolkata';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const money = (n: number | null | undefined) => inr.format(n ?? 0);

const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: BUSINESS_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: BUSINESS_TZ, hour: '2-digit', minute: '2-digit', hour12: true });
const dayLabelFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' });

export const formatDate = (iso: string | Date | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : '—');
export const formatTime = (iso: string | Date | null | undefined) => (iso ? timeFmt.format(new Date(iso)).toUpperCase() : '—');
export const formatDateTime = (iso: string | Date | null | undefined) => (iso ? `${formatDate(iso)} ${formatTime(iso)}` : '—');
/** 'YYYY-MM-DD' → '3 Oct' (date-only strings, no timezone shift). */
export const formatDayLabel = (ymd: string) => dayLabelFmt.format(new Date(`${ymd}T00:00:00Z`));

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr${h > 1 ? 's' : ''}`;
}

/** Countdown text 'HH:MM:SS' for a number of milliseconds. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Business-local { date: 'YYYY-MM-DD', time: 'HH:mm' } for an instant. */
export function businessParts(d: Date): { date: string; time: string } {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Converts IST wall-clock date+time to an instant (IST is a fixed +05:30). */
export const istToDate = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

export const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll('_', ' ');
