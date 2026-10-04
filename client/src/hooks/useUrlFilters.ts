import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

/**
 * Keeps list filters in the URL so they survive refreshes and can be shared.
 * Changing any filter resets to page 1.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();

  const filters = useMemo(() => Object.fromEntries(keys.map((k) => [k, params.get(k) ?? ''])) as Record<K, string>, [params, keys]);
  const page = Math.max(1, Number(params.get('page')) || 1);

  const setFilter = useCallback(
    (key: K, value: string) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          next.delete('page');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const setPage = useCallback(
    (p: number) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (p > 1) next.set('page', String(p));
          else next.delete('page');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const reset = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);
  const active = keys.some((k) => filters[k]);

  return { filters, page, setFilter, setPage, reset, active };
}
