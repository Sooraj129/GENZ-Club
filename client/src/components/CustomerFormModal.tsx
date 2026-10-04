import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { api } from '../api';
import { errorData, errorMessage, errorStatus } from '../api/client';
import type { Customer } from '../types';
import { Button, Field, Input, Modal } from './ui';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-()]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
    .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number'),
  email: z.union([z.literal(''), z.email('Enter a valid email address')]).optional(),
});
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

/**
 * Create or edit a customer. When the phone number already belongs to someone,
 * the existing customer is shown so staff can continue with them instead.
 */
export function CustomerFormModal({
  open,
  onClose,
  customer,
  initialPhone,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  customer?: Customer | null;
  initialPhone?: string;
  onSaved?: (c: Customer) => void;
}) {
  const qc = useQueryClient();
  const [existing, setExisting] = useState<Customer | null>(null);
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (open) {
      setExisting(null);
      form.reset({ name: customer?.name ?? '', phone: customer?.phone ?? initialPhone ?? '', email: customer?.email ?? '' });
    }
  }, [open, customer, initialPhone, form]);

  const save = useMutation({
    mutationFn: (v: FormOutput) => {
      const body = { name: v.name, phone: v.phone, email: v.email || null };
      return customer ? api.customers.update(customer.id, body) : api.customers.create(body);
    },
    onSuccess: (c) => {
      toast.success(customer ? 'Customer updated' : `Customer ${c.name} created`);
      qc.invalidateQueries({ queryKey: ['customers'] });
      onSaved?.(c);
      onClose();
    },
    onError: (err) => {
      const dup = errorData<{ customer?: Customer }>(err)?.customer;
      if (errorStatus(err) === 409 && dup) setExisting(dup);
      else toast.error(errorMessage(err));
    },
  });

  const { errors } = form.formState;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={customer ? 'Edit customer' : 'New customer'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}>
            {customer ? 'Save changes' : 'Create customer'}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        {existing && (
          <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm" role="alert">
            <p className="font-medium text-warning-ink">Customer already exists</p>
            <p className="mt-1 text-ink">
              {existing.name} · {existing.phone}
              {existing.email ? ` · ${existing.email}` : ''}
            </p>
            {onSaved && !customer && (
              <Button
                size="sm"
                className="mt-2"
                onClick={() => {
                  onSaved(existing);
                  onClose();
                }}
              >
                Use this customer
              </Button>
            )}
          </div>
        )}
        <Field label="Name" htmlFor="c-name" error={errors.name?.message}>
          <Input id="c-name" autoFocus invalid={!!errors.name} {...form.register('name')} />
        </Field>
        <Field label="Phone" htmlFor="c-phone" error={errors.phone?.message}>
          <Input id="c-phone" type="tel" inputMode="tel" invalid={!!errors.phone} {...form.register('phone')} />
        </Field>
        <Field label="Email (optional)" htmlFor="c-email" error={errors.email?.message}>
          <Input id="c-email" type="email" invalid={!!errors.email} {...form.register('email')} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
