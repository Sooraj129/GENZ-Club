import clsx from 'clsx';
import { Ban, CheckCircle2, CircleDot, Clock, Gamepad2, PauseCircle, Wrench, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ConsoleStatus, PaymentStatus, SessionStatus } from '../types';

type Tone = 'good' | 'critical' | 'warning' | 'neutral' | 'info' | 'muted';

// Status always carries an icon + text label, never colour alone.
const tones: Record<Tone, string> = {
  good: 'bg-good/10 text-good-ink ring-good/30',
  critical: 'bg-critical/10 text-critical-ink ring-critical/30',
  warning: 'bg-warning/15 text-warning-ink ring-warning/40',
  neutral: 'bg-black/5 text-ink-2 ring-black/10',
  info: 'bg-brand-50 text-brand-700 ring-brand-500/30',
  muted: 'bg-black/5 text-ink-muted ring-black/10',
};

const icon = 'size-3.5';

const CONSOLE: Record<ConsoleStatus, { tone: Tone; label: string; icon: ReactNode }> = {
  AVAILABLE: { tone: 'good', label: 'Available', icon: <CheckCircle2 className={icon} aria-hidden /> },
  PLAYING: { tone: 'critical', label: 'Playing', icon: <Gamepad2 className={icon} aria-hidden /> },
  RESERVED: { tone: 'warning', label: 'Reserved', icon: <Clock className={icon} aria-hidden /> },
  MAINTENANCE: { tone: 'neutral', label: 'Maintenance', icon: <Wrench className={icon} aria-hidden /> },
  DISABLED: { tone: 'muted', label: 'Disabled', icon: <Ban className={icon} aria-hidden /> },
};

const SESSION: Record<SessionStatus, { tone: Tone; label: string; icon: ReactNode }> = {
  SCHEDULED: { tone: 'warning', label: 'Scheduled', icon: <Clock className={icon} aria-hidden /> },
  ACTIVE: { tone: 'critical', label: 'Playing', icon: <Gamepad2 className={icon} aria-hidden /> },
  PAUSED: { tone: 'neutral', label: 'Paused', icon: <PauseCircle className={icon} aria-hidden /> },
  COMPLETED: { tone: 'info', label: 'Completed', icon: <CheckCircle2 className={icon} aria-hidden /> },
  EXPIRED: { tone: 'info', label: 'Time up', icon: <CircleDot className={icon} aria-hidden /> },
  CANCELLED: { tone: 'muted', label: 'Cancelled', icon: <XCircle className={icon} aria-hidden /> },
};

const PAYMENT: Record<PaymentStatus, { tone: Tone; label: string; icon: ReactNode }> = {
  PENDING: { tone: 'warning', label: 'Pending', icon: <Clock className={icon} aria-hidden /> },
  PARTIALLY_PAID: { tone: 'warning', label: 'Partially paid', icon: <CircleDot className={icon} aria-hidden /> },
  PAID: { tone: 'good', label: 'Paid', icon: <CheckCircle2 className={icon} aria-hidden /> },
  CANCELLED: { tone: 'muted', label: 'Cancelled', icon: <XCircle className={icon} aria-hidden /> },
};

function Badge({ tone, label, icon }: { tone: Tone; label: string; icon: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone])}>
      {icon}
      {label}
    </span>
  );
}

export const ConsoleStatusBadge = ({ status }: { status: ConsoleStatus }) => <Badge {...CONSOLE[status]} />;
export const SessionStatusBadge = ({ status }: { status: SessionStatus }) => <Badge {...SESSION[status]} />;
export const PaymentStatusBadge = ({ status }: { status: PaymentStatus | null }) =>
  status ? <Badge {...PAYMENT[status]} /> : <span className="text-xs text-ink-muted">—</span>;

export function ConsoleTypeTag({ type }: { type: 'PS4' | 'PS5' }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-2">
      <span className="size-2 rounded-full" style={{ background: type === 'PS5' ? 'var(--color-series-1)' : 'var(--color-series-2)' }} aria-hidden />
      {type}
    </span>
  );
}
