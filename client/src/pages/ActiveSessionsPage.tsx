import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, PauseCircle, Play, Timer, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { api } from '../api';
import { errorMessage } from '../api/client';
import { PausedSessionCard, SessionCard } from '../components/SessionCard';
import { EndSessionDialog, ExtendSessionDialog, ResumeSessionDialog } from '../components/SessionDialogs';
import { ConsoleTypeTag } from '../components/StatusBadge';
import { Button, Card, EmptyState, ErrorState, PageHeader, Select, Spinner, Table, Td, Th } from '../components/ui';
import { useServerNow } from '../hooks/useServerNow';
import type { Session } from '../types';
import { formatDateTime, formatDuration, formatTime, money } from '../utils/format';

type SortKey = 'ending' | 'start';

export default function ActiveSessionsPage() {
  const qc = useQueryClient();
  const now = useServerNow();
  const [sort, setSort] = useState<SortKey>('ending');
  const [ending, setEnding] = useState<Session | null>(null);
  const [extending, setExtending] = useState<Session | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [resuming, setResuming] = useState<Session | null>(null);

  // Socket events keep this fresh; the interval is a safety net if the socket drops.
  const q = useQuery({ queryKey: ['sessions', 'active'], queryFn: api.sessions.active, refetchInterval: 60_000 });

  const active = useMemo(() => {
    const list = [...(q.data?.active ?? [])];
    return sort === 'ending'
      ? list.sort((a, b) => +new Date(a.end_datetime) - +new Date(b.end_datetime))
      : list.sort((a, b) => +new Date(a.start_datetime) - +new Date(b.start_datetime));
  }, [q.data, sort]);

  const invalidate = () => ['sessions', 'consoles', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const start = useMutation({
    mutationFn: api.sessions.start,
    onSuccess: (s) => {
      toast.success(`${s.customer_name} started on ${s.console_number}`);
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  // Pause ("stop"): clock + billing stop, console is freed until Resume.
  const pause = useMutation({
    mutationFn: (s: Session) => api.sessions.pause(s.id),
    onSuccess: (s) => {
      toast.success(
        s.status === 'PAUSED'
          ? `Paused ${s.customer_name} · ${formatDuration(s.booked_minutes - s.played_minutes)} left to play later`
          : `No time was left — ${s.customer_name}'s session was ended`,
      );
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const cancel = useMutation({
    mutationFn: api.sessions.cancel,
    onSuccess: () => {
      toast.success('Booking cancelled');
      setCancelling(null);
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div>
      <PageHeader
        title="Active Sessions"
        description="Live timers follow the server clock. Sessions close automatically at their end time."
        actions={
          <>
            <label className="sr-only" htmlFor="sort">
              Sort by
            </label>
            <div className="w-44">
              <Select id="sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="ending">Ending soonest</option>
                <option value="start">Start time</option>
              </Select>
            </div>
            <Link to="/sessions/new">
              <Button icon={<CalendarPlus className="size-4" aria-hidden />}>New Session</Button>
            </Link>
          </>
        }
      />

      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <Card>
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <>
          {active.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Timer className="size-6" aria-hidden />}
                title="No one is playing right now"
                description="Start a session and its live timer will appear here."
                action={
                  <Link to="/sessions/new">
                    <Button>Start a session</Button>
                  </Link>
                }
              />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {active.map((s) => (
                <SessionCard key={s.id} session={s} now={now} onEnd={setEnding} onExtend={setExtending} onPause={(x) => pause.mutate(x)} pausing={pause.isPending && pause.variables?.id === s.id} />
              ))}
            </div>
          )}

          {(q.data?.paused.length ?? 0) > 0 && (
            <>
              <h2 className="mb-1 mt-10 flex items-center gap-2 text-lg font-semibold text-ink">
                <PauseCircle className="size-5 text-ink-muted" aria-hidden /> Paused
              </h2>
              <p className="mb-3 text-sm text-ink-2">These customers stopped for a while. Resume when they're back, or End to bill the time played.</p>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {q.data!.paused.map((s) => (
                  <PausedSessionCard key={s.id} session={s} now={now} onResume={setResuming} onEnd={setEnding} />
                ))}
              </div>
            </>
          )}

          <h2 className="mb-3 mt-10 text-lg font-semibold text-ink">Upcoming bookings</h2>
          <Card>
            {(q.data?.upcoming.length ?? 0) === 0 ? (
              <EmptyState title="No upcoming bookings" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Customer</Th>
                    <Th>Console</Th>
                    <Th>Start</Th>
                    <Th>End</Th>
                    <Th>Duration</Th>
                    <Th className="text-right">Estimate</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {q.data!.upcoming.map((s) => (
                    <tr key={s.id}>
                      <Td>
                        <p className="font-medium">{s.customer_name}</p>
                        <p className="text-xs text-ink-muted">{s.customer_phone}</p>
                      </Td>
                      <Td>
                        <span className="font-medium">{s.console_number}</span> <ConsoleTypeTag type={s.console_type} />
                      </Td>
                      <Td className="tabular">{formatDateTime(s.start_datetime)}</Td>
                      <Td className="tabular">{formatTime(s.end_datetime)}</Td>
                      <Td>{formatDuration(s.booked_minutes)}</Td>
                      <Td className="tabular text-right">{money(s.estimated_amount)}</Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="secondary" icon={<Play className="size-3.5" aria-hidden />} loading={start.isPending && start.variables === s.id} onClick={() => start.mutate(s.id)}>
                            Start now
                          </Button>
                          <Button size="sm" variant="ghost" icon={<X className="size-3.5" aria-hidden />} onClick={() => setCancelling(s.id)}>
                            Cancel
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}

      <EndSessionDialog session={ending} onClose={() => setEnding(null)} />
      <ExtendSessionDialog session={extending} onClose={() => setExtending(null)} />
      <ResumeSessionDialog session={resuming} onClose={() => setResuming(null)} />
      {cancelling && (
        <CancelConfirm onClose={() => setCancelling(null)} loading={cancel.isPending} onConfirm={() => cancel.mutate(cancelling)} />
      )}
    </div>
  );
}

function CancelConfirm({ onClose, onConfirm, loading }: { onClose: () => void; onConfirm: () => void; loading: boolean }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="alertdialog" aria-modal="true" aria-label="Cancel booking">
      <Card className="w-full max-w-sm p-5">
        <p className="font-semibold text-ink">Cancel this booking?</p>
        <p className="mt-1 text-sm text-ink-2">The console slot will be released. This cannot be undone.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Keep booking
          </Button>
          <Button variant="danger" loading={loading} onClick={onConfirm}>
            Cancel booking
          </Button>
        </div>
      </Card>
    </div>
  );
}
