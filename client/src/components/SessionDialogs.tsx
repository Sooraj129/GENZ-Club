import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import { errorMessage } from '../api/client';
import type { Session } from '../types';
import { formatDuration, formatTime, money } from '../utils/format';
import { serverNow } from '../utils/serverClock';
import { Button, Field, Input, KeyValue, Modal, Spinner } from './ui';

function useInvalidateSessions() {
  const qc = useQueryClient();
  return () => {
    for (const key of ['sessions', 'consoles', 'dashboard', 'invoices']) qc.invalidateQueries({ queryKey: [key] });
  };
}

/** "End this gaming session?" — amounts come from the server's BillingService, not the browser. */
export function EndSessionDialog({ session, onClose }: { session: Session | null; onClose: () => void }) {
  const invalidate = useInvalidateSessions();
  const preview = useQuery({
    queryKey: ['sessions', session?.id, 'end-preview'],
    queryFn: () => api.sessions.endPreview(session!.id),
    enabled: !!session,
    gcTime: 0,
    staleTime: 0,
  });
  const end = useMutation({
    mutationFn: () => api.sessions.end(session!.id),
    onSuccess: (s) => {
      toast.success(`Session ended · Invoice ${s.invoice_number} · ${money(s.final_amount)}`);
      invalidate();
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Modal
      open={!!session}
      onClose={onClose}
      title="End this gaming session?"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={end.isPending} disabled={!preview.data} onClick={() => end.mutate()}>
            Confirm
          </Button>
        </>
      }
    >
      {session && (
        <div>
          <p className="mb-3 text-sm text-ink-2">
            {session.customer_name} on {session.console_number}, booked {formatTime(session.start_datetime)} – {formatTime(session.end_datetime)}
          </p>
          {preview.isLoading ? (
            <Spinner label="Calculating…" />
          ) : preview.isError ? (
            <p className="text-sm text-critical-ink">{errorMessage(preview.error)}</p>
          ) : (
            preview.data && (
              <div className="rounded-lg bg-plane px-3 py-2">
                <KeyValue label="Actual duration" value={formatDuration(preview.data.duration_minutes)} />
                {preview.data.membership_minutes > 0 && (
                  <KeyValue label={`Membership (${session.membership_name ?? 'package'})`} value={`− ${formatDuration(preview.data.membership_minutes)}`} />
                )}
                <KeyValue label="Rate" value={`${money(preview.data.hourly_rate)}/hr`} />
                <KeyValue label="Estimated final amount" value={money(preview.data.final_amount)} strong />
              </div>
            )
          )}
          <p className="mt-3 text-xs text-ink-muted">The final amount is calculated by the server at the moment you confirm.</p>
        </div>
      )}
    </Modal>
  );
}

/**
 * Resume a paused session. Default: the same console. Any other in-service
 * console of the same type can be chosen (the session keeps its booked rate).
 * The server checks the console is free for the remaining time.
 */
export function ResumeSessionDialog({ session, onClose }: { session: Session | null; onClose: () => void }) {
  const invalidate = useInvalidateSessions();
  const [consoleId, setConsoleId] = useState<string>('');
  const consoles = useQuery({ queryKey: ['consoles'], queryFn: api.consoles.list, enabled: !!session });
  const sameType = (consoles.data ?? []).filter(
    (c) => session && c.console_type === session.console_type && c.status !== 'MAINTENANCE' && c.status !== 'DISABLED',
  );
  const chosen = consoleId || session?.console_id || '';
  const left = session ? session.booked_minutes - session.played_minutes : 0;

  const resume = useMutation({
    mutationFn: () => api.sessions.resume(session!.id, chosen !== session!.console_id ? chosen : undefined),
    onSuccess: (s) => {
      toast.success(`${s.customer_name} resumed on ${s.console_number} · ends ${formatTime(s.end_datetime)}`);
      invalidate();
      setConsoleId('');
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Modal
      open={!!session}
      onClose={() => (setConsoleId(''), onClose())}
      title="Resume session"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => (setConsoleId(''), onClose())}>
            Cancel
          </Button>
          <Button loading={resume.isPending} disabled={!chosen} onClick={() => resume.mutate()}>
            Resume now
          </Button>
        </>
      }
    >
      {session && (
        <div className="space-y-4">
          <div className="rounded-lg bg-plane px-3 py-2">
            <KeyValue label="Customer" value={session.customer_name} />
            <KeyValue label="Played so far" value={formatDuration(session.played_minutes)} />
            <KeyValue label="Time left" value={formatDuration(left)} strong />
            <KeyValue label="Will end at" value={formatTime(new Date(serverNow() + left * 60_000))} />
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink">Console ({session.console_type})</legend>
            <div className="grid grid-cols-2 gap-2">
              {sameType.map((c) => (
                <label
                  key={c.id}
                  className={
                    chosen === c.id
                      ? 'flex cursor-pointer items-center justify-between rounded-lg border-2 border-brand-500 bg-brand-50 px-3 py-2 text-sm'
                      : 'flex cursor-pointer items-center justify-between rounded-lg border border-hairline px-3 py-2 text-sm hover:bg-plane'
                  }
                >
                  <input type="radio" name="resume-console" className="sr-only" checked={chosen === c.id} onChange={() => setConsoleId(c.id)} />
                  <span className="font-medium">{c.console_number}</span>
                  <span className="text-xs text-ink-muted">{c.id === session.console_id ? 'same' : c.status === 'AVAILABLE' ? 'free' : c.status.toLowerCase()}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-ink-muted">The server checks the console is free for the remaining time.</p>
        </div>
      )}
    </Modal>
  );
}

const PRESETS = [
  { label: '+30 minutes', minutes: 30 },
  { label: '+1 hour', minutes: 60 },
  { label: '+2 hours', minutes: 120 },
];

export function ExtendSessionDialog({ session, onClose }: { session: Session | null; onClose: () => void }) {
  const invalidate = useInvalidateSessions();
  const [minutes, setMinutes] = useState<number>(30);
  const [custom, setCustom] = useState('');
  const isCustom = minutes === -1;
  const effective = isCustom ? Number(custom) : minutes;
  const valid = Number.isInteger(effective) && effective >= 5 && effective <= 720;

  const extend = useMutation({
    mutationFn: () => api.sessions.extend(session!.id, effective),
    onSuccess: (s) => {
      toast.success(`Extended to ${formatTime(s.end_datetime)} · Estimate ${money(s.estimated_amount)}`);
      invalidate();
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const newEnd = session && valid ? new Date(new Date(session.end_datetime).getTime() + effective * 60_000) : null;

  return (
    <Modal
      open={!!session}
      onClose={onClose}
      title="Extend session"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={extend.isPending} disabled={!valid} onClick={() => extend.mutate()}>
            Extend
          </Button>
        </>
      }
    >
      {session && (
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            {session.customer_name} · {session.console_number} · currently ends {formatTime(session.end_datetime)}
          </p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Extension">
            {[...PRESETS, { label: 'Custom', minutes: -1 }].map((p) => (
              <button
                key={p.label}
                role="radio"
                aria-checked={minutes === p.minutes}
                onClick={() => setMinutes(p.minutes)}
                className={
                  minutes === p.minutes
                    ? 'rounded-lg border-2 border-brand-500 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700'
                    : 'rounded-lg border border-hairline px-3 py-2 text-sm hover:bg-plane'
                }
              >
                {p.label}
              </button>
            ))}
          </div>
          {isCustom && (
            <Field label="Minutes" htmlFor="custom-minutes" hint="Between 5 and 720 minutes">
              <Input id="custom-minutes" type="number" min={5} max={720} value={custom} onChange={(e) => setCustom(e.target.value)} autoFocus />
            </Field>
          )}
          {newEnd && (
            <div className="rounded-lg bg-plane px-3 py-2">
              <KeyValue label="New end time" value={formatTime(newEnd)} strong />
            </div>
          )}
          <p className="text-xs text-ink-muted">Availability is checked on the server before the session is extended.</p>
        </div>
      )}
    </Modal>
  );
}
