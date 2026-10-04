import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import { errorMessage } from '../api/client';
import { ConsoleStatusBadge, ConsoleTypeTag } from '../components/StatusBadge';
import { Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import type { ConsoleType, GameConsole } from '../types';
import { formatTime, money } from '../utils/format';

type AdminStatus = 'AVAILABLE' | 'MAINTENANCE' | 'DISABLED';

function ConsoleForm({ open, console: c, onClose }: { open: boolean; console: GameConsole | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [number, setNumber] = useState('');
  const [type, setType] = useState<ConsoleType>('PS5');
  const [override, setOverride] = useState('');
  const [status, setStatus] = useState<AdminStatus>('AVAILABLE');

  useEffect(() => {
    if (!open) return;
    setNumber(c?.console_number ?? '');
    setType(c?.console_type ?? 'PS5');
    setOverride(c?.rate_override ? String(c.rate_override) : '');
    setStatus(c && (c.status === 'MAINTENANCE' || c.status === 'DISABLED') ? c.status : 'AVAILABLE');
  }, [open, c]);

  const save = useMutation({
    mutationFn: () => {
      const body = { console_number: number.trim().toUpperCase(), console_type: type, hourly_rate: override ? Number(override) : null, status };
      return c ? api.consoles.update(c.id, body) : api.consoles.create(body);
    },
    onSuccess: () => {
      toast.success(c ? 'Console updated' : 'Console added');
      qc.invalidateQueries({ queryKey: ['consoles'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const valid = /^[A-Za-z0-9-]{1,20}$/.test(number.trim()) && (!override || Number(override) > 0);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={c ? `Edit ${c.console_number}` : 'Add console'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Console number" htmlFor="cn" hint="e.g. PS5-04">
          <Input id="cn" value={number} onChange={(e) => setNumber(e.target.value)} autoFocus />
        </Field>
        <Field label="Type" htmlFor="ct">
          <Select id="ct" value={type} onChange={(e) => setType(e.target.value as ConsoleType)}>
            <option value="PS5">PS5</option>
            <option value="PS4">PS4</option>
          </Select>
        </Field>
        <Field label="Hourly rate override (optional)" htmlFor="cr" hint="Leave empty to use the standard price for this type (Settings → Pricing)">
          <Input id="cr" type="number" min={1} step="1" value={override} onChange={(e) => setOverride(e.target.value)} />
        </Field>
        <Field label="Status" htmlFor="cs" hint="In-service consoles show Available / Reserved / Playing automatically">
          <Select id="cs" value={status} onChange={(e) => setStatus(e.target.value as AdminStatus)}>
            <option value="AVAILABLE">In service</option>
            <option value="MAINTENANCE">Maintenance</option>
            <option value="DISABLED">Disabled</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

export default function ConsolesPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['consoles'], queryFn: api.consoles.list });
  const [editing, setEditing] = useState<GameConsole | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<GameConsole | null>(null);

  // Server only allows deleting consoles that were never booked; otherwise it
  // explains to set the status to Disabled (keeps past invoices intact).
  const remove = useMutation({
    mutationFn: (id: string) => api.consoles.remove(id),
    onSuccess: () => {
      toast.success(`${deleting?.console_number} deleted`);
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['consoles'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div>
      <PageHeader
        title="Consoles"
        description="Status updates live as sessions start and end."
        actions={
          isAdmin && (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
              Add console
            </Button>
          )
        }
      />
      <Card>
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : q.data!.length === 0 ? (
          <EmptyState icon={<Monitor className="size-6" aria-hidden />} title="No consoles yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Console</Th>
                <Th>Type</Th>
                <Th>Rate</Th>
                <Th>Status</Th>
                <Th>Now</Th>
                {isAdmin && <Th />}
              </tr>
            </thead>
            <tbody>
              {q.data!.map((c) => (
                <tr key={c.id}>
                  <Td className="font-medium">{c.console_number}</Td>
                  <Td>
                    <ConsoleTypeTag type={c.console_type} />
                  </Td>
                  <Td className="tabular">
                    {money(c.hourly_rate)}/hr
                    {c.rate_override !== null && <span className="ml-1 text-xs text-ink-muted">(custom)</span>}
                  </Td>
                  <Td>
                    <ConsoleStatusBadge status={c.status} />
                  </Td>
                  <Td className="text-sm text-ink-2">
                    {c.current_customer_name
                      ? `${c.current_customer_name} until ${formatTime(c.current_end_datetime)}`
                      : c.next_start_datetime
                        ? `Next booking ${formatTime(c.next_start_datetime)}`
                        : '—'}
                  </Td>
                  {isAdmin && (
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" aria-hidden />} onClick={() => setEditing(c)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" className="text-critical-ink hover:bg-critical/10" icon={<Trash2 className="size-3.5" aria-hidden />} onClick={() => setDeleting(c)}>
                          Delete
                        </Button>
                      </div>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <ConsoleForm open={creating || !!editing} console={editing} onClose={() => (setCreating(false), setEditing(null))} />
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.console_number ?? ''}?`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">
          Only consoles that have never been booked can be deleted. If this console has session history, set its status to{' '}
          <strong>Disabled</strong> instead — it disappears from the dashboard and booking screen, and old invoices stay correct.
        </p>
      </Modal>
    </div>
  );
}
