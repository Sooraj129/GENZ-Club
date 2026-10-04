/**
 * Cards on the Active Sessions page.
 *
 *   SessionCard        a playing session with a live countdown + Pause / Extend / End
 *   PausedSessionCard  a paused session: time played, time left + Resume / End
 *
 * Timers are display-only and run on the server-aligned clock (useServerNow).
 * The server alone decides when a session ends.
 */
import clsx from 'clsx';
import { BadgePercent, Clock, Pause, Phone, Play, Plus, Square } from 'lucide-react';
import type { Session } from '../types';
import { formatCountdown, formatDuration, formatTime, money } from '../utils/format';
import { ConsoleTypeTag, SessionStatusBadge } from './StatusBadge';
import { Button, Card } from './ui';

/** Small tag shown when a session is being played on a membership package. */
function MembershipTag({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-600/20">
      <BadgePercent className="size-3" aria-hidden /> {name}
    </span>
  );
}

function CardHeader({ session }: { session: Session }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-ink">{session.customer_name}</p>
          <p className="flex items-center gap-1 text-xs text-ink-muted">
            <Phone className="size-3" aria-hidden /> {session.customer_phone}
          </p>
        </div>
        <SessionStatusBadge status={session.status} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold text-ink">{session.console_number}</span>
        <ConsoleTypeTag type={session.console_type} />
        {session.membership_name && <MembershipTag name={session.membership_name} />}
      </div>
    </>
  );
}

export function SessionCard({
  session,
  now,
  onPause,
  onExtend,
  onEnd,
  pausing,
}: {
  session: Session;
  now: number;
  onPause: (s: Session) => void;
  onExtend: (s: Session) => void;
  onEnd: (s: Session) => void;
  pausing?: boolean;
}) {
  const segmentStart = new Date(session.segment_start_datetime).getTime();
  const end = new Date(session.end_datetime).getTime();
  const remaining = end - now;
  // Progress over the whole booking, including time played before any pause.
  const playedMs = session.played_minutes * 60_000 + Math.max(0, Math.min(now, end) - segmentStart);
  const progress = Math.min(100, Math.max(0, (playedMs / (session.booked_minutes * 60_000)) * 100));
  const timeUp = remaining <= 0;
  const endingSoon = !timeUp && remaining <= 10 * 60_000;

  return (
    <Card className={clsx('flex flex-col p-4', endingSoon && 'ring-2 ring-warning/60', timeUp && 'opacity-80')}>
      <CardHeader session={session} />

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-ink-muted">{session.pause_count > 0 ? 'Resumed' : 'Started'}</dt>
          <dd className="tabular text-ink">{formatTime(session.segment_start_datetime)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Ends</dt>
          <dd className="tabular text-ink">{formatTime(session.end_datetime)}</dd>
        </div>
      </dl>

      <div className="mt-4">
        <p className="text-xs text-ink-muted">Remaining</p>
        <p className={clsx('tabular text-3xl font-semibold tracking-tight', timeUp ? 'text-ink-muted' : endingSoon ? 'text-warning-ink' : 'text-ink')}>
          {formatCountdown(remaining)}
        </p>
        {timeUp ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-ink-2">
            <Clock className="size-3" aria-hidden /> Time up — the server is closing this session
          </p>
        ) : endingSoon ? (
          <p className="mt-1 text-xs font-medium text-warning-ink">Ending soon</p>
        ) : session.pause_count > 0 ? (
          <p className="mt-1 text-xs text-ink-muted">Paused {session.pause_count}× · {formatDuration(session.played_minutes)} played before</p>
        ) : null}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/5" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Session progress">
          <div className={clsx('h-full rounded-full', endingSoon || timeUp ? 'bg-warning' : 'bg-brand-500')} style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="mt-4 flex items-baseline justify-between">
        <span className="text-xs text-ink-muted">
          {formatDuration(session.booked_minutes)} · {money(session.hourly_rate)}/hr
        </span>
        <span className="tabular text-xl font-semibold text-ink">{money(session.estimated_amount)}</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Button variant="secondary" size="sm" icon={<Pause className="size-4" aria-hidden />} onClick={() => onPause(session)} disabled={timeUp} loading={pausing}>
          Pause
        </Button>
        <Button variant="secondary" size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => onExtend(session)} disabled={timeUp}>
          Extend
        </Button>
        <Button variant="danger" size="sm" icon={<Square className="size-3.5" aria-hidden />} onClick={() => onEnd(session)} disabled={timeUp}>
          End
        </Button>
      </div>
    </Card>
  );
}

export function PausedSessionCard({
  session,
  now,
  onResume,
  onEnd,
}: {
  session: Session;
  now: number;
  onResume: (s: Session) => void;
  onEnd: (s: Session) => void;
}) {
  const left = session.booked_minutes - session.played_minutes;
  const pausedFor = session.paused_at ? Math.max(0, Math.floor((now - new Date(session.paused_at).getTime()) / 60_000)) : 0;

  return (
    <Card className="flex flex-col border-dashed p-4">
      <CardHeader session={session} />
      <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-ink-muted">Played</dt>
          <dd className="font-medium tabular text-ink">{formatDuration(session.played_minutes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Time left</dt>
          <dd className="font-semibold tabular text-brand-700">{formatDuration(left)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Paused</dt>
          <dd className="tabular text-ink">{formatTime(session.paused_at)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-ink-muted">
        Paused for {formatDuration(pausedFor)} · console is free for others until resumed
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button size="sm" icon={<Play className="size-4" aria-hidden />} onClick={() => onResume(session)}>
          Resume
        </Button>
        <Button variant="danger" size="sm" icon={<Square className="size-3.5" aria-hidden />} onClick={() => onEnd(session)}>
          End & bill
        </Button>
      </div>
    </Card>
  );
}
