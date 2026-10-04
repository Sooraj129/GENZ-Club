/**
 * Memberships: prepaid play-time packages (e.g. "799 Package").
 *
 *   Members tab  every package sold, with hours left and expiry; sell new ones
 *   Plans tab    (admin) create/edit the packages that can be sold
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BadgePercent, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { api } from '../api';
import { errorMessage } from '../api/client';
import { BalanceBar, MembershipStateBadge } from '../components/MembershipBits';
import { SellMembershipDialog } from '../components/SellMembershipDialog';
import { PaymentStatusBadge } from '../components/StatusBadge';
import { Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useDebounce } from '../hooks/useDebounce';
import { useUrlFilters } from '../hooks/useUrlFilters';
import type { ConsoleType, MembershipPlan } from '../types';
import { formatDate, formatDuration, money } from '../utils/format';

// ---------------------------------------------------------------- plans (admin)

function PlanForm({ open, plan, onClose }: { open: boolean; plan: MembershipPlan | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', price: '', hours: '', console_type: '', validity_days: '30', is_active: true });
  useEffect(() => {
    if (!open) return;
    setForm({
      name: plan?.name ?? '',
      price: plan ? String(plan.price) : '',
      hours: plan ? String(plan.minutes / 60) : '',
      console_type: plan?.console_type ?? '',
      validity_days: String(plan?.validity_days ?? 30),
      is_active: plan?.is_active ?? true,
    });
  }, [open, plan]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        price: Number(form.price),
        hours: Number(form.hours),
        console_type: (form.console_type || null) as ConsoleType | null,
        validity_days: Number(form.validity_days),
      };
      return plan ? api.memberships.updatePlan(plan.id, { ...body, is_active: form.is_active }) : api.memberships.createPlan(body);
    },
    onSuccess: () => {
      toast.success(plan ? 'Package updated' : 'Package created');
      qc.invalidateQueries({ queryKey: ['memberships'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const valid = form.name.trim() && Number(form.price) >= 0 && form.price !== '' && Number(form.hours) > 0 && Number(form.validity_days) >= 1;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={plan ? `Edit ${plan.name}` : 'New package'}
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
        <Field label="Package name" htmlFor="pl-name" hint='e.g. "799 Package"'>
          <Input id="pl-name" value={form.name} onChange={set('name')} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price (₹)" htmlFor="pl-price">
            <Input id="pl-price" type="number" min={0} value={form.price} onChange={set('price')} />
          </Field>
          <Field label="Play time (hours)" htmlFor="pl-hours">
            <Input id="pl-hours" type="number" min={0.5} step="0.5" value={form.hours} onChange={set('hours')} />
          </Field>
          <Field label="Console" htmlFor="pl-type">
            <Select id="pl-type" value={form.console_type} onChange={set('console_type')}>
              <option value="">Any console</option>
              <option value="PS5">PS5 only</option>
              <option value="PS4">PS4 only</option>
            </Select>
          </Field>
          <Field label="Valid for (days)" htmlFor="pl-days">
            <Input id="pl-days" type="number" min={1} value={form.validity_days} onChange={set('validity_days')} />
          </Field>
        </div>
        {plan && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} /> On sale
          </label>
        )}
        <p className="text-xs text-ink-muted">Changes apply to future sales. Packages already sold keep their original hours and expiry.</p>
      </div>
    </Modal>
  );
}

function PlansTab() {
  const q = useQuery({ queryKey: ['memberships', 'plans', 'all'], queryFn: () => api.memberships.plans(true) });
  const [editing, setEditing] = useState<MembershipPlan | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
          New package
        </Button>
      </div>
      <Card>
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : q.data!.length === 0 ? (
          <EmptyState title="No packages yet" description='Create one — e.g. "799 Package" with its hours and validity.' />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Package</Th>
                <Th className="text-right">Price</Th>
                <Th>Play time</Th>
                <Th>Console</Th>
                <Th>Validity</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {q.data!.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td className="tabular text-right">{money(p.price)}</Td>
                  <Td>{formatDuration(p.minutes)}</Td>
                  <Td>{p.console_type ?? 'Any'}</Td>
                  <Td>{p.validity_days} days</Td>
                  <Td>{p.is_active ? <span className="text-good-ink">On sale</span> : <span className="text-ink-muted">Retired</span>}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" aria-hidden />} onClick={() => setEditing(p)}>
                      Edit
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <PlanForm open={creating || !!editing} plan={editing} onClose={() => (setCreating(false), setEditing(null))} />
    </>
  );
}

// ---------------------------------------------------------------- members

const KEYS = ['search', 'state'] as const;

function MembersTab() {
  const { filters, page, setFilter, setPage } = useUrlFilters(KEYS);
  const search = useDebounce(filters.search, 300);
  const query = { search, state: filters.state, page, pageSize: 20 };
  const q = useQuery({ queryKey: ['memberships', 'list', query], queryFn: () => api.memberships.list(query), placeholderData: keepPreviousData });

  return (
    <>
      <Card className="mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        <Field label="Search" htmlFor="m-search">
          <Input id="m-search" placeholder="Customer, phone or package" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
        </Field>
        <Field label="Status" htmlFor="m-state">
          <Select id="m-state" value={filters.state} onChange={(e) => setFilter('state', e.target.value)}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="USED_UP">Used up</option>
            <option value="EXPIRED">Expired</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
        </Field>
      </Card>
      <Card>
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : q.data!.data.length === 0 ? (
          <EmptyState icon={<BadgePercent className="size-6" aria-hidden />} title="No memberships sold yet" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Customer</Th>
                  <Th>Package</Th>
                  <Th>Hours left</Th>
                  <Th>Bought</Th>
                  <Th>Expires</Th>
                  <Th>Status</Th>
                  <Th>Payment</Th>
                </tr>
              </thead>
              <tbody className={q.isPlaceholderData ? 'opacity-60' : undefined}>
                {q.data!.data.map((m) => (
                  <tr key={m.id}>
                    <Td>
                      <Link to={`/customers/${m.customer_id}`} className="font-medium hover:underline">
                        {m.customer_name}
                      </Link>
                      <p className="text-xs text-ink-muted">{m.customer_phone}</p>
                    </Td>
                    <Td>
                      <p className="font-medium">{m.plan_name}</p>
                      <p className="text-xs text-ink-muted">
                        {money(m.price)} · {m.console_type ?? 'any console'}
                      </p>
                    </Td>
                    <Td>
                      <BalanceBar left={m.minutes_left} total={m.minutes_total} />
                    </Td>
                    <Td className="tabular">{formatDate(m.purchased_at)}</Td>
                    <Td className="tabular">{formatDate(m.expires_at)}</Td>
                    <Td>
                      <MembershipStateBadge state={m.state} />
                    </Td>
                    <Td>
                      {m.invoice_id ? (
                        <Link to={`/invoices/${m.invoice_id}`} className="inline-flex flex-col gap-0.5 hover:underline">
                          <PaymentStatusBadge status={m.payment_status} />
                        </Link>
                      ) : (
                        '—'
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={q.data!.meta.page} totalPages={q.data!.meta.totalPages} total={q.data!.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

export default function MembershipsPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<'members' | 'plans'>('members');
  const [selling, setSelling] = useState(false);

  return (
    <div>
      <PageHeader
        title="Memberships"
        description="Prepaid play-time packages. Sessions booked on a package use its hours first."
        actions={
          <Button icon={<BadgePercent className="size-4" aria-hidden />} onClick={() => setSelling(true)}>
            Sell membership
          </Button>
        }
      />
      {isAdmin && (
        <div className="mb-4 inline-flex rounded-lg border border-hairline bg-white p-0.5" role="tablist">
          {(['members', 'plans'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={clsx('rounded-md px-4 py-1.5 text-sm', tab === t ? 'bg-ink text-white' : 'text-ink-2 hover:bg-plane')}
            >
              {t === 'members' ? 'Members' : 'Plans'}
            </button>
          ))}
        </div>
      )}
      {tab === 'plans' && isAdmin ? <PlansTab /> : <MembersTab />}
      <SellMembershipDialog open={selling} onClose={() => setSelling(false)} />
    </div>
  );
}
