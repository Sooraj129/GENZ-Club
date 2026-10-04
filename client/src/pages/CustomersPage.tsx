import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { errorMessage } from '../api/client';
import { CustomerFormModal } from '../components/CustomerFormModal';
import { Button, Card, EmptyState, ErrorState, Input, PageHeader, Pagination, Spinner, Table, Td, Th } from '../components/ui';
import { useDebounce } from '../hooks/useDebounce';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { formatDate, money } from '../utils/format';

const KEYS = ['search'] as const;

export default function CustomersPage() {
  const navigate = useNavigate();
  const { filters, page, setFilter, setPage } = useUrlFilters(KEYS);
  const search = useDebounce(filters.search, 300);
  const [creating, setCreating] = useState(false);

  const q = useQuery({
    queryKey: ['customers', 'list', search, page],
    queryFn: () => api.customers.list({ search, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Search by name or phone. Phone numbers are unique per customer."
        actions={
          <Button icon={<UserPlus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
            New customer
          </Button>
        }
      />
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
        <Input aria-label="Search customers" placeholder="Search name, phone or email" className="pl-9" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
      </div>
      <Card>
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : q.data!.data.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" aria-hidden />}
            title={search ? 'No customers match' : 'No customers yet'}
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                Add customer
              </Button>
            }
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Phone</Th>
                  <Th>Email</Th>
                  <Th className="text-right">Sessions</Th>
                  <Th className="text-right">Total spent</Th>
                  <Th>Last visit</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className={q.isPlaceholderData ? 'opacity-60' : undefined}>
                {q.data!.data.map((c) => (
                  <tr key={c.id} className="hover:bg-plane/60">
                    <Td>
                      <Link to={`/customers/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                    </Td>
                    <Td className="tabular">{c.phone}</Td>
                    <Td className="text-ink-2">{c.email ?? '—'}</Td>
                    <Td className="tabular text-right">{c.total_sessions}</Td>
                    <Td className="tabular text-right">{money(c.total_spent)}</Td>
                    <Td className="tabular">{formatDate(c.last_visit)}</Td>
                    <Td className="text-right">
                      <Button size="sm" variant="secondary" onClick={() => navigate(`/sessions/new?customer=${c.id}`)}>
                        New session
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={q.data!.meta.page} totalPages={q.data!.meta.totalPages} total={q.data!.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      <CustomerFormModal open={creating} onClose={() => setCreating(false)} onSaved={(c) => navigate(`/customers/${c.id}`)} />
    </div>
  );
}
