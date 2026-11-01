/**
 * Admin corrections on Session History — every one needs a reason and is
 * recorded on the server (session_amount_changes), so changes can be traced.
 *
 *   EditAmountDialog     correct a finished session's amount (invoice follows)
 *   DeleteSessionDialog  cancel + mark deleted (kept in history as "Deleted")
 *   ChangesDialog        who changed what, when and why
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import { errorMessage } from '../api/client';
import type { Session } from '../types';
import { formatDateTime, money } from '../utils/format';
import { Button, EmptyState, Field, Input, KeyValue, Modal, Spinner } from './ui';

function useRefresh() {
  const qc = useQueryClient();
  return () => ['sessions', 'invoices', 'dashboard', 'consoles', 'customers', 'memberships', 'payments', 'reports'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

const REASON_HINT = 'Required — saved with the change so it can be checked later.';

export function EditAmountDialog({ session, onClose }: { session: Session | null; onClose: () => void }) {
  const refresh = useRefresh();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (session) {
      setAmount(String(session.final_amount ?? ''));
      setReason('');
    }
  }, [session]);

  const value = Number(amount);
  const valid = amount !== '' && Number.isFinite(value) && value >= 0 && reason.trim().length >= 3;

  const save = useMutation({
    mutationFn: () => api.sessions.editAmount(session!.id, Math.round(value * 100) / 100, reason.trim()),
    onSuccess: (s) => {
      toast.success(`Amount changed to ${money(s.final_amount)} — invoice updated`);
      refresh();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Modal
      open={!!session}
      onClose={onClose}
      title="Edit amount"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            Save amount
          </Button>
        </>
      }
    >
      {session && (
        <div className="space-y-4">
          <div className="rounded-lg bg-plane px-3 py-2">
            <KeyValue label="Customer" value={session.customer_name} />
            <KeyValue label="Console" value={session.console_number} />
            <KeyValue label="Current amount" value={money(session.final_amount)} strong />
          </div>
          <Field label="New amount (₹)" htmlFor="edit-amount" hint="The invoice is updated to match.">
            <Input id="edit-amount" type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <Field label="Reason" htmlFor="edit-reason" hint={REASON_HINT}>
            <Input id="edit-reason" placeholder="e.g. Regular customer discount" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
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
                      {c.action === 'DELETE' ? 'Deleted' : `Amount ${money(c.old_amount)} → ${money(c.new_amount)}`}
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
