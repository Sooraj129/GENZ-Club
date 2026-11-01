/**
 * Admin corrections on Session History — every one needs a reason and is
 * recorded on the server (session_amount_changes), so changes can be traced.
 *
 *   EditAmountDialog     correct a finished session's duration and/or amount (invoice follows)
 *   DeleteSessionDialog  cancel + mark deleted (kept in history as "Deleted")
 *   ChangesDialog        who changed what, when and why
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import { errorMessage } from '../api/client';
import type { Session } from '../types';
import { useDebounce } from '../hooks/useDebounce';
import { formatDateTime, formatDuration, money } from '../utils/format';
import { Button, EmptyState, Field, Input, KeyValue, Modal, Spinner } from './ui';

function useRefresh() {
  const qc = useQueryClient();
  return () => ['sessions', 'invoices', 'dashboard', 'consoles', 'customers', 'memberships', 'payments', 'reports'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

const REASON_HINT = 'Required — saved with the change so it can be checked later.';

/**
 * Edit a finished session's duration and/or amount.
 * Changing the duration recalculates the amount on the server (rate × players,
 * membership hours first); the amount can still be overridden by hand.
 */
export function EditAmountDialog({ session, onClose }: { session: Session | null; onClose: () => void }) {
  const refresh = useRefresh();
  const [hours, setHours] = useState('0');
  const [mins, setMins] = useState('0');
  const [amount, setAmount] = useState('');
  const [amountTouched, setAmountTouched] = useState(false); // staff typed an amount → don't overwrite it
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (session) {
      const d = session.duration_minutes ?? 0;
      setHours(String(Math.floor(d / 60)));
      setMins(String(d % 60));
      setAmount(String(session.final_amount ?? ''));
      setAmountTouched(false);
      setReason('');
    }
  }, [session]);

  const oldDuration = session?.duration_minutes ?? 0;
  const newDuration = (Number(hours) || 0) * 60 + (Number(mins) || 0);
  const durationValid = Number.isInteger(newDuration) && newDuration >= 1 && newDuration <= 24 * 60;
  const durationChanged = durationValid && newDuration !== oldDuration;
  const debouncedDuration = useDebounce(newDuration, 300);

  // Server-calculated price for the new duration (same rate, players, membership).
  const price = useQuery({
    queryKey: ['session-price', session?.id, debouncedDuration],
    queryFn: () => api.sessions.price(session!.id, debouncedDuration),
    // Ask only for a valid (settled) duration — e.g. not the 0 shown mid-typing.
    enabled: !!session && debouncedDuration >= 1 && debouncedDuration <= 24 * 60 && debouncedDuration !== oldDuration,
  });
  useEffect(() => {
    if (price.data && !amountTouched) setAmount(String(price.data.amount));
  }, [price.data, amountTouched]);

  const value = Number(amount);
  const amountValid = amount !== '' && Number.isFinite(value) && value >= 0;
  const amountChanged = amountValid && Math.round(value * 100) !== Math.round((session?.final_amount ?? 0) * 100);
  const valid = durationValid && amountValid && reason.trim().length >= 3 && (durationChanged || amountChanged);

  const save = useMutation({
    mutationFn: () =>
      api.sessions.editAmount(
        session!.id,
        {
          ...(durationChanged ? { duration_minutes: newDuration } : {}),
          // Send the amount only when it was typed by hand or the duration didn't change;
          // otherwise the server recalculates it from the new duration.
          ...(amountTouched || !durationChanged ? { amount: Math.round(value * 100) / 100 } : {}),
        },
        reason.trim(),
      ),
    onSuccess: (s) => {
      toast.success(`Updated: ${formatDuration(s.duration_minutes)} · ${money(s.final_amount)} — invoice updated`);
      refresh();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Modal
      open={!!session}
      onClose={onClose}
      title="Edit duration / amount"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            Save changes
          </Button>
        </>
      }
    >
      {session && (
        <div className="space-y-4">
          <div className="rounded-lg bg-plane px-3 py-2">
            <KeyValue label="Customer" value={session.customer_name} />
            <KeyValue label="Console" value={`${session.console_number}${session.players > 1 ? ` · ${session.players} players` : ''}`} />
            <KeyValue label="Current" value={`${formatDuration(session.duration_minutes)} · ${money(session.final_amount)}`} strong />
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Duration played</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Hours" htmlFor="edit-hours">
                <Input id="edit-hours" type="number" min={0} max={24} value={hours} onChange={(e) => setHours(e.target.value)} />
              </Field>
              <Field label="Minutes" htmlFor="edit-mins">
                <Input id="edit-mins" type="number" min={0} max={59} value={mins} onChange={(e) => setMins(e.target.value)} />
              </Field>
            </div>
            {!durationValid && <p className="mt-1 text-xs text-critical-ink">Enter between 1 minute and 24 hours.</p>}
          </div>

          <Field
            label="Amount (₹)"
            htmlFor="edit-amount"
            hint={
              durationChanged && !amountTouched
                ? price.isFetching
                  ? 'Recalculating…'
                  : `Recalculated for ${formatDuration(newDuration)} at ${money(session.hourly_rate)}/hr${session.players > 1 ? ` × ${session.players}` : ''}. Change it for a discount.`
                : 'The invoice is updated to match.'
            }
          >
            <Input
              id="edit-amount"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setAmountTouched(true);
              }}
            />
          </Field>

          <Field label="Reason" htmlFor="edit-reason" hint={REASON_HINT}>
            <Input id="edit-reason" placeholder="e.g. Customer left early, timer not stopped" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

export function DeleteSessionDialog({ session, onClose }: { session: Session | null; onClose: () => void }) {
  const refresh = useRefresh();
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (session) setReason('');
  }, [session]);

  const remove = useMutation({
    mutationFn: () => api.sessions.remove(session!.id, reason.trim()),
    onSuccess: (s) => {
      toast.success(`${s.customer_name}'s session on ${s.console_number} deleted`);
      refresh();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Modal
      open={!!session}
      onClose={onClose}
      title="Delete this session?"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="danger" disabled={reason.trim().length < 3} loading={remove.isPending} onClick={() => remove.mutate()}>
            Delete session
          </Button>
        </>
      }
    >
      {session && (
        <div className="space-y-4">
          <div className="rounded-lg bg-plane px-3 py-2">
            <KeyValue label="Customer" value={session.customer_name} />
            <KeyValue label="Console" value={session.console_number} />
            <KeyValue label="Amount" value={money(session.final_amount ?? session.estimated_amount)} strong />
          </div>
          <p className="text-sm text-ink-2">
            The session and its invoice are cancelled and removed from revenue. If it's playing now, the console is freed. It stays in Session History
            marked <strong>Deleted</strong>, with your reason. Sessions that already have a payment can't be deleted — edit the amount instead.
          </p>
          <Field label="Reason" htmlFor="delete-reason" hint={REASON_HINT}>
            <Input id="delete-reason" placeholder="e.g. Entered by mistake" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus />
          </Field>
        </div>
      )}
    </Modal>
  );
}

export function ChangesDialog({ session, onClose }: { session: Session | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['sessions', session?.id, 'changes'], queryFn: () => api.sessions.changes(session!.id), enabled: !!session });
  return (
    <Modal open={!!session} onClose={onClose} title="Change history" size="md">
      {session && (
        <div>
          <p className="mb-3 text-sm text-ink-2">
            {session.customer_name} · {session.console_number} · {formatDateTime(session.start_datetime)}
          </p>
          {q.isLoading ? (
            <Spinner />
          ) : !q.data?.length ? (
            <EmptyState title="No changes recorded" />
          ) : (
            <ol className="space-y-3">
              {q.data.map((c) => (
                <li key={c.id} className="rounded-lg border border-hairline px-3 py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className={c.action === 'DELETE' ? 'text-sm font-semibold text-critical-ink' : 'text-sm font-semibold text-ink'}>
                      {c.action === 'DELETE'
                        ? 'Deleted'
                        : [
                            c.old_duration !== null && c.new_duration !== null
                              ? `Duration ${formatDuration(c.old_duration)} → ${formatDuration(c.new_duration)}`
                              : null,
                            c.old_amount !== c.new_amount ? `Amount ${money(c.old_amount)} → ${money(c.new_amount)}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                    </span>
                    <span className="text-xs text-ink-muted tabular">{formatDateTime(c.created_at)}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink-2">“{c.reason}”</p>
                  <p className="mt-0.5 text-xs text-ink-muted">by {c.changed_by_name ?? 'unknown user'}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Modal>
  );
}
