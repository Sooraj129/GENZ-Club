import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import { errorMessage } from '../api/client';
import { ConsoleTypeTag } from '../components/StatusBadge';
import { Button, Card, ErrorState, Field, Input, PageHeader, Spinner } from '../components/ui';
import type { BusinessSettings, ConsoleType } from '../types';
import { formatDateTime } from '../utils/format';

export default function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });
  const [prices, setPrices] = useState<Record<ConsoleType, string>>({ PS4: '', PS5: '' });
  const [biz, setBiz] = useState<BusinessSettings | null>(null);

  useEffect(() => {
    if (!q.data) return;
    setPrices(Object.fromEntries(q.data.pricing.map((p) => [p.console_type, String(p.hourly_rate)])) as Record<ConsoleType, string>);
    setBiz(q.data.settings);
  }, [q.data]);

  const savePricing = useMutation({
    mutationFn: () => api.settings.updatePricing((Object.keys(prices) as ConsoleType[]).map((t) => ({ console_type: t, hourly_rate: Number(prices[t]) }))),
    onSuccess: () => {
      toast.success('Pricing saved — applies to new sessions');
      ['settings', 'consoles', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveBiz = useMutation({
    mutationFn: () => api.settings.update(biz!),
    onSuccess: () => {
      toast.success('Settings saved');
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading || !biz) return q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : <Spinner />;
  const pricesValid = Object.values(prices).every((v) => Number(v) > 0);

  return (
    <div>
      <PageHeader title="Settings" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink">Pricing</h2>
          <p className="mt-1 text-sm text-ink-2">New sessions use these hourly rates. Existing sessions keep the rate they were booked at.</p>
          <div className="mt-4 space-y-4">
            {q.data!.pricing.map((p) => (
              <Field key={p.console_type} label={`${p.console_type} hourly price (₹)`} htmlFor={`price-${p.console_type}`} hint={`Last changed ${formatDateTime(p.updated_at)}`}>
                <div className="flex items-center gap-3">
                  <Input
                    id={`price-${p.console_type}`}
                    type="number"
                    min={1}
                    step="1"
                    value={prices[p.console_type]}
                    onChange={(e) => setPrices((s) => ({ ...s, [p.console_type]: e.target.value }))}
                    className="max-w-40"
                  />
                  <ConsoleTypeTag type={p.console_type} />
                </div>
              </Field>
            ))}
          </div>
          <Button className="mt-5" disabled={!pricesValid} loading={savePricing.isPending} onClick={() => savePricing.mutate()}>
            Save pricing
          </Button>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink">Business & billing</h2>
          <div className="mt-4 space-y-4">
            <Field label="Business name" htmlFor="s-name" hint="Printed on invoices">
              <Input id="s-name" value={biz.business_name} onChange={(e) => setBiz({ ...biz, business_name: e.target.value })} />
            </Field>
            <Field label="Address" htmlFor="s-addr">
              <Input id="s-addr" value={biz.business_address} onChange={(e) => setBiz({ ...biz, business_address: e.target.value })} />
            </Field>
            <Field label="Phone" htmlFor="s-phone">
              <Input id="s-phone" value={biz.business_phone} onChange={(e) => setBiz({ ...biz, business_phone: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Tax (%)" htmlFor="s-tax" hint="Applied to new invoices">
                <Input id="s-tax" type="number" min={0} max={50} step="0.01" value={biz.tax_percent} onChange={(e) => setBiz({ ...biz, tax_percent: Number(e.target.value) })} />
              </Field>
              <Field label="Reserved window (min)" htmlFor="s-res" hint="Console shows Reserved this long before a booking">
                <Input
                  id="s-res"
                  type="number"
                  min={0}
                  max={240}
                  value={biz.reservation_window_minutes}
                  onChange={(e) => setBiz({ ...biz, reservation_window_minutes: Number(e.target.value) })}
                />
              </Field>
            </div>
          </div>
          <Button className="mt-5" disabled={!biz.business_name.trim()} loading={saveBiz.isPending} onClick={() => saveBiz.mutate()}>
            Save settings
          </Button>
        </Card>
      </div>
    </div>
  );
}
