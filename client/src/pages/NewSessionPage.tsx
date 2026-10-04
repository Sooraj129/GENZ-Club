import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, BadgePercent, CheckCircle2, Search, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { api } from '../api';
import { errorMessage } from '../api/client';
import { CustomerFormModal } from '../components/CustomerFormModal';
import { ConsoleStatusBadge, ConsoleTypeTag } from '../components/StatusBadge';
import { Button, Card, EmptyState, Field, Input, KeyValue, PageHeader, Spinner } from '../components/ui';
import { useDebounce } from '../hooks/useDebounce';
import type { ConsoleType, Customer, GameConsole } from '../types';
import { addDaysYmd, businessParts, formatDate, formatDateTime, formatDuration, formatTime, istToDate, money } from '../utils/format';
import { serverNow } from '../utils/serverClock';

const QUICK_DURATIONS = [30, 60, 90, 120, 180];
const UNBOOKABLE = new Set(['MAINTENANCE', 'DISABLED']);

function endFrom(date: string, time: string, minutes: number) {
  return businessParts(new Date(istToDate(date, time).getTime() + minutes * 60_000));
}

export default function NewSessionPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();

  // ---- customer
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [term, setTerm] = useState('');
  const debounced = useDebounce(term.trim(), 250);
  const [showNew, setShowNew] = useState(false);

  const preselect = params.get('customer');
  const preselected = useQuery({ queryKey: ['customers', preselect], queryFn: () => api.customers.get(preselect!), enabled: !!preselect && !customer });
  useEffect(() => {
    if (preselected.data && !customer) setCustomer(preselected.data);
  }, [preselected.data, customer]);

  const results = useQuery({
    queryKey: ['customers', 'search', debounced],
    queryFn: () => api.customers.search(debounced),
    enabled: debounced.length >= 2 && !customer,
  });

  // ---- console
  const [typeFilter, setTypeFilter] = useState<ConsoleType | 'ALL'>('ALL');
  const [consoleId, setConsoleId] = useState<string | null>(params.get('console'));
  const consoles = useQuery({ queryKey: ['consoles'], queryFn: api.consoles.list });
  const selectedConsole = consoles.data?.find((c) => c.id === consoleId) ?? null;
  const visibleConsoles = (consoles.data ?? []).filter((c) => c.status !== 'DISABLED' && (typeFilter === 'ALL' || c.console_type === typeFilter));

  // ---- membership (optional): play on a prepaid package's hours
  const [membershipId, setMembershipId] = useState<string>('');
  const memberships = useQuery({
    queryKey: ['memberships', 'customer', customer?.id],
    queryFn: () => api.memberships.forCustomer(customer!.id),
    enabled: !!customer,
  });
  // Only packages that are active and valid for the chosen console type.
  const usableMemberships = (memberships.data ?? []).filter(
    (m) => m.state === 'ACTIVE' && (!m.console_type || !selectedConsole || m.console_type === selectedConsole.console_type),
  );
  useEffect(() => {
    if (membershipId && !usableMemberships.some((m) => m.id === membershipId)) setMembershipId('');
  }, [membershipId, usableMemberships]);
  useEffect(() => setMembershipId(''), [customer?.id]);

  // ---- time window (IST wall clock), defaulting to now → +1h
  const initial = useMemo(() => {
    const start = businessParts(new Date(serverNow()));
    const end = endFrom(start.date, start.time, 60);
    return { start_date: start.date, start_time: start.time, end_date: end.date, end_time: end.time };
  }, []);
  const [win, setWin] = useState(initial);
  const setStart = (patch: Partial<typeof win>) => setWin((w) => ({ ...w, ...patch }));
  const applyDuration = (minutes: number) => {
    const end = endFrom(win.start_date, win.start_time, minutes);
    setWin((w) => ({ ...w, end_date: end.date, end_time: end.time }));
  };
  const setNow = () => {
    const minutes = Math.max(15, Math.round((istToDate(win.end_date, win.end_time).getTime() - istToDate(win.start_date, win.start_time).getTime()) / 60_000));
    const start = businessParts(new Date(serverNow()));
    const end = endFrom(start.date, start.time, minutes);
    setWin({ start_date: start.date, start_time: start.time, end_date: end.date, end_time: end.time });
  };

  const windowValid = Boolean(win.start_date && win.start_time && win.end_date && win.end_time);
  const debouncedWin = useDebounce(win, 300);

  // ---- server-side quote: duration, rate, estimate and availability
  const quote = useQuery({
    queryKey: ['sessions', 'quote', consoleId, debouncedWin, membershipId],
    queryFn: () => api.sessions.quote({ console_id: consoleId!, ...debouncedWin, membership_id: membershipId || undefined }),
    enabled: !!consoleId && windowValid,
    retry: false,
  });

  const schedule = useQuery({
    queryKey: ['sessions', 'console-schedule', consoleId, win.start_date],
    queryFn: () => api.consoles.schedule(consoleId!, win.start_date),
    enabled: !!consoleId && !!win.start_date,
  });

  const create = useMutation({
    mutationFn: () => api.sessions.create({ customer_id: customer!.id, console_id: consoleId!, ...win, membership_id: membershipId || undefined }),
    onSuccess: (s) => {
      const what = s.status === 'ACTIVE' ? 'started' : s.status === 'SCHEDULED' ? 'booked' : 'recorded';
      toast.success(`Session ${what}: ${s.customer_name} on ${s.console_number}`);
      for (const k of ['sessions', 'consoles', 'dashboard', 'invoices']) qc.invalidateQueries({ queryKey: [k] });
      navigate(s.status === 'ACTIVE' || s.status === 'SCHEDULED' ? '/sessions/active' : '/sessions/history');
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      qc.invalidateQueries({ queryKey: ['sessions', 'quote'] });
    },
  });

  const canSubmit = !!customer && !!selectedConsole && windowValid && quote.data?.available === true && !quote.isFetching;
  const looksLikePhone = /^[\d\s+-]{6,}$/.test(term);

  return (
    <div>
      <PageHeader title="New Session" description="Find the customer, pick a console and time. Availability and price are checked by the server." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Step 1 — customer */}
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">1 · Customer</h2>
            {customer ? (
              <div className="flex items-center justify-between rounded-lg border border-brand-500/40 bg-brand-50 px-4 py-3">
                <div>
                  <p className="font-medium text-ink">{customer.name}</p>
                  <p className="text-sm text-ink-2">
                    {customer.phone}
                    {customer.email ? ` · ${customer.email}` : ''}
                  </p>
                </div>
                <Button variant="ghost" size="sm" icon={<X className="size-4" aria-hidden />} onClick={() => setCustomer(null)}>
                  Change
                </Button>
              </div>
            ) : null}
            {customer && usableMemberships.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-sm font-medium text-ink">Pay with</p>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Pay with">
                  <button
                    role="radio"
                    aria-checked={!membershipId}
                    onClick={() => setMembershipId('')}
                    className={clsx('rounded-lg border px-3 py-2 text-left text-sm', !membershipId ? 'border-2 border-brand-500 bg-brand-50' : 'border-hairline hover:bg-plane')}
                  >
                    <span className="block font-medium">Pay per hour</span>
                    <span className="block text-xs text-ink-muted">Billed at the console rate</span>
                  </button>
                  {usableMemberships.map((m) => (
                    <button
                      key={m.id}
                      role="radio"
                      aria-checked={membershipId === m.id}
                      onClick={() => setMembershipId(m.id)}
                      className={clsx(
                        'rounded-lg border px-3 py-2 text-left text-sm',
                        membershipId === m.id ? 'border-2 border-violet-500 bg-violet-50' : 'border-hairline hover:bg-plane',
                      )}
                    >
                      <span className="flex items-center gap-1.5 font-medium">
                        <BadgePercent className="size-4 text-violet-600" aria-hidden /> {m.plan_name}
                      </span>
                      <span className="block text-xs text-ink-muted">
                        {formatDuration(m.minutes_left)} left · until {formatDate(m.expires_at)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {customer ? null : (
              <>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
                    <Input
                      aria-label="Search customer by phone or name"
                      placeholder="Search by phone number or name"
                      className="pl-9"
                      value={term}
                      onChange={(e) => setTerm(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <Button variant="secondary" icon={<UserPlus className="size-4" aria-hidden />} onClick={() => setShowNew(true)}>
                    New
                  </Button>
                </div>
                {debounced.length >= 2 && (
                  <div className="mt-3">
                    {results.isFetching && !results.data ? (
                      <Spinner label="Searching…" />
                    ) : results.data?.length ? (
                      <ul className="divide-y divide-hairline rounded-lg border border-hairline">
                        {results.data.map((c) => (
                          <li key={c.id}>
                            <button className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-plane" onClick={() => setCustomer(c)}>
                              <span>
                                <span className="block font-medium text-ink">{c.name}</span>
                                <span className="block text-sm text-ink-2">
                                  {c.phone}
                                  {c.email ? ` · ${c.email}` : ''}
                                </span>
                              </span>
                              <span className="text-sm text-brand-600">Select</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState
                        title="No customer found"
                        description="Create them now — it only takes a name and phone number."
                        action={
                          <Button size="sm" icon={<UserPlus className="size-4" aria-hidden />} onClick={() => setShowNew(true)}>
                            Create customer
                          </Button>
                        }
                      />
                    )}
                  </div>
                )}
              </>
            )}
          </Card>

          {/* Step 2 — console */}
          <Card className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">2 · Console</h2>
              <div className="inline-flex rounded-lg border border-hairline p-0.5" role="group" aria-label="Console type">
                {(['ALL', 'PS5', 'PS4'] as const).map((t) => (
                  <button
                    key={t}
                    aria-pressed={typeFilter === t}
                    onClick={() => setTypeFilter(t)}
                    className={clsx('rounded-md px-3 py-1 text-sm', typeFilter === t ? 'bg-ink text-white' : 'text-ink-2 hover:bg-plane')}
                  >
                    {t === 'ALL' ? 'All' : t}
                  </button>
                ))}
              </div>
            </div>
            {consoles.isLoading ? (
              <Spinner />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {visibleConsoles.map((c: GameConsole) => {
                  const blocked = UNBOOKABLE.has(c.status);
                  const selected = c.id === consoleId;
                  return (
                    <button
                      key={c.id}
                      disabled={blocked}
                      onClick={() => setConsoleId(c.id)}
                      aria-pressed={selected}
                      className={clsx(
                        'rounded-xl border p-3 text-left transition-colors',
                        selected ? 'border-2 border-brand-500 bg-brand-50' : 'border-hairline hover:bg-plane',
                        blocked && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-ink">{c.console_number}</span>
                        <ConsoleTypeTag type={c.console_type} />
                      </div>
                      <p className="mt-1 text-sm text-ink-2">{money(c.hourly_rate)}/hr</p>
                      <div className="mt-2">
                        <ConsoleStatusBadge status={c.status} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Step 3 — time */}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">3 · Time (IST)</h2>
              <Button variant="ghost" size="sm" onClick={setNow}>
                Start now
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start date" htmlFor="sd">
                  <Input id="sd" type="date" value={win.start_date} onChange={(e) => setStart({ start_date: e.target.value })} />
                </Field>
                <Field label="Start time" htmlFor="st">
                  <Input id="st" type="time" value={win.start_time} onChange={(e) => setStart({ start_time: e.target.value })} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="End date" htmlFor="ed">
                  <Input id="ed" type="date" value={win.end_date} min={win.start_date} max={addDaysYmd(win.start_date || initial.start_date, 1)} onChange={(e) => setStart({ end_date: e.target.value })} />
                </Field>
                <Field label="End time" htmlFor="et">
                  <Input id="et" type="time" value={win.end_time} onChange={(e) => setStart({ end_time: e.target.value })} />
                </Field>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_DURATIONS.map((m) => (
                <Button key={m} variant="secondary" size="sm" onClick={() => applyDuration(m)}>
                  {formatDuration(m)}
                </Button>
              ))}
            </div>

            {selectedConsole && (
              <div className="mt-5">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
                  {selectedConsole.console_number} bookings on {win.start_date ? formatDate(istToDate(win.start_date, '12:00')) : '—'}
                </p>
                {schedule.data?.length ? (
                  <ul className="flex flex-wrap gap-2">
                    {schedule.data.map((b) => (
                      <li key={b.id} className="rounded-md bg-plane px-2 py-1 text-xs tabular text-ink-2">
                        {formatTime(b.segment_start_datetime)} – {formatTime(b.end_datetime)} · {b.status === 'ACTIVE' ? 'Playing' : 'Booked'}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-ink-muted">No bookings — free all day.</p>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Summary */}
        <div>
          <Card className="sticky top-6 p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Summary</h2>
            <KeyValue label="Customer" value={customer?.name ?? '—'} />
            <KeyValue label="Console" value={selectedConsole ? `${selectedConsole.console_number} (${selectedConsole.console_type})` : '—'} />
            <KeyValue label="Start" value={windowValid ? formatDateTime(istToDate(win.start_date, win.start_time)) : '—'} />
            <KeyValue label="End" value={windowValid ? formatDateTime(istToDate(win.end_date, win.end_time)) : '—'} />
            <div className="my-3 border-t border-hairline" />
            {quote.data ? (
              <>
                <KeyValue label="Duration" value={formatDuration(quote.data.duration_minutes)} />
                {quote.data.membership_minutes > 0 && (
                  <KeyValue label="Membership covers" value={`− ${formatDuration(quote.data.membership_minutes)}`} />
                )}
                <KeyValue label="Rate" value={`${money(quote.data.hourly_rate)}/hour`} />
                <KeyValue label="Estimated Total" value={<span className="text-lg">{money(quote.data.estimated_amount)}</span>} strong />
              </>
            ) : quote.isError ? (
              <p className="flex gap-2 text-sm text-critical-ink" role="alert">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {errorMessage(quote.error)}
              </p>
            ) : (
              <p className="text-sm text-ink-muted">{consoleId ? 'Calculating…' : 'Select a console to see the price.'}</p>
            )}

            {quote.data && (
              <p className={clsx('mt-3 flex items-start gap-2 text-sm', quote.data.available ? 'text-good-ink' : 'text-critical-ink')} role="status">
                {quote.data.available ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
                {quote.data.available ? 'Available for the selected time' : quote.data.message}
              </p>
            )}

            <Button className="mt-5 w-full" disabled={!canSubmit} loading={create.isPending} onClick={() => create.mutate()}>
              Create Session
            </Button>
            {!customer && <p className="mt-2 text-center text-xs text-ink-muted">Select a customer to continue</p>}
          </Card>
        </div>
      </div>

      <CustomerFormModal
        open={showNew}
        onClose={() => setShowNew(false)}
        initialPhone={looksLikePhone ? term.trim() : undefined}
        onSaved={(c) => {
          setCustomer(c);
          setTerm('');
        }}
      />
    </div>
  );
}
