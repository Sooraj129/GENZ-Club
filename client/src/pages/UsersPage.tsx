import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { api } from '../api';
import { errorMessage } from '../api/client';
import { Button, Card, ErrorState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import type { Role, User } from '../types';
import { formatDate } from '../utils/format';

const password = z
  .string()
  .min(8, 'At least 8 characters')
  .regex(/[A-Za-z]/, 'Must contain a letter')
  .regex(/\d/, 'Must contain a number');

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.email('Enter a valid email'),
  role: z.enum(['ADMIN', 'STAFF']),
  password: z.union([z.literal(''), password]),
  is_active: z.boolean(),
});
type Values = z.infer<typeof schema>;

function UserForm({ open, user, onClose }: { open: boolean; user: User | null; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  useEffect(() => {
    if (open) form.reset({ name: user?.name ?? '', email: user?.email ?? '', role: user?.role ?? 'STAFF', password: '', is_active: user?.is_active ?? true });
  }, [open, user, form]);

  const save = useMutation({
    mutationFn: (v: Values) => {
      if (!user && !v.password) throw new Error('A password is required for new users');
      return user
        ? api.users.update(user.id, { name: v.name, email: v.email, role: v.role as Role, is_active: v.is_active, ...(v.password ? { password: v.password } : {}) })
        : api.users.create({ name: v.name, email: v.email, role: v.role as Role, password: v.password });
    },
    onSuccess: () => {
      toast.success(user ? 'User updated' : 'User created');
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error && !('isAxiosError' in e) ? e.message : errorMessage(e)),
  });
  const { errors } = form.formState;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user ? `Edit ${user.name}` : 'New user'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" htmlFor="u-name" error={errors.name?.message}>
          <Input id="u-name" {...form.register('name')} />
        </Field>
        <Field label="Email" htmlFor="u-email" error={errors.email?.message}>
          <Input id="u-email" type="email" {...form.register('email')} />
        </Field>
        <Field label="Role" htmlFor="u-role">
          <Select id="u-role" {...form.register('role')}>
            <option value="STAFF">Staff</option>
            <option value="ADMIN">Admin</option>
          </Select>
        </Field>
        <Field label={user ? 'New password (leave blank to keep)' : 'Password'} htmlFor="u-pass" error={errors.password?.message} hint="At least 8 characters with a letter and a number">
          <Input id="u-pass" type="password" autoComplete="new-password" {...form.register('password')} />
        </Field>
        {user && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" {...form.register('is_active')} /> Active (can sign in)
          </label>
        )}
      </div>
    </Modal>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const q = useQuery({ queryKey: ['users'], queryFn: api.users.list });
  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        title="Users"
        description="Admins manage pricing, consoles, users and reports. Staff run the front desk."
        actions={
          <Button icon={<UserPlus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
            New user
          </Button>
        }
      />
      <Card>
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {q.data!.map((u) => (
                <tr key={u.id}>
                  <Td className="font-medium">
                    {u.name} {u.id === me?.id && <span className="text-xs text-ink-muted">(you)</span>}
                  </Td>
                  <Td>{u.email}</Td>
                  <Td>{u.role === 'ADMIN' ? 'Admin' : 'Staff'}</Td>
                  <Td>{u.is_active ? <span className="text-good-ink">Active</span> : <span className="text-ink-muted">Deactivated</span>}</Td>
                  <Td className="tabular">{formatDate(u.created_at)}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" aria-hidden />} onClick={() => setEditing(u)}>
                      Edit
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <UserForm open={creating || !!editing} user={editing} onClose={() => (setCreating(false), setEditing(null))} />
    </div>
  );
}
