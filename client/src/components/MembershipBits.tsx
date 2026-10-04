/** Small membership display pieces shared by the Memberships page and customer profile. */
import clsx from 'clsx';
import type { MembershipState } from '../types';
import { formatDuration } from '../utils/format';

const STATE_STYLE: Record<MembershipState, string> = {
  ACTIVE: 'bg-good/10 text-good-ink ring-good/30',
  USED_UP: 'bg-black/5 text-ink-2 ring-black/10',
  EXPIRED: 'bg-warning/15 text-warning-ink ring-warning/40',
  CANCELLED: 'bg-black/5 text-ink-muted ring-black/10',
};
const STATE_LABEL: Record<MembershipState, string> = { ACTIVE: 'Active', USED_UP: 'Used up', EXPIRED: 'Expired', CANCELLED: 'Cancelled' };

export function MembershipStateBadge({ state }: { state: MembershipState }) {
  return <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', STATE_STYLE[state])}>{STATE_LABEL[state]}</span>;
}

/** Hours-left bar, e.g. "4 hrs 30 min left of 6 hrs". */
export function BalanceBar({ left, total }: { left: number; total: number }) {
  const pct = total ? (left / total) * 100 : 0;
  return (
    <div className="min-w-36">
      <p className="text-sm tabular">
        <span className="font-semibold text-ink">{formatDuration(left)}</span> <span className="text-ink-muted">of {formatDuration(total)}</span>
      </p>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/5">
        <div className="h-full rounded-full bg-violet-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
