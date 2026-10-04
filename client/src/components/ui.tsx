import clsx from 'clsx';
import { AlertCircle, Inbox, Loader2, X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

// ------------------------------------------------------------------ Button
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white shadow-sm shadow-brand-600/20 hover:bg-brand-700 focus-visible:ring-brand-500 disabled:bg-brand-600/50',
  secondary: 'bg-white text-ink border border-hairline shadow-sm hover:bg-plane focus-visible:ring-brand-500',
  danger: 'bg-critical text-white hover:bg-critical-ink focus-visible:ring-critical disabled:bg-critical/50',
  ghost: 'text-ink-2 hover:bg-black/5 focus-visible:ring-brand-500',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        variants[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

// ------------------------------------------------------------------ Form fields
export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-critical-ink" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const control =
  'block w-full rounded-lg border border-hairline bg-white px-3 text-sm text-ink placeholder:text-ink-muted focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-plane disabled:text-ink-muted';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} className={clsx(control, 'h-10', invalid && 'border-critical', className)} aria-invalid={invalid || undefined} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={clsx(control, 'h-10 pr-8', invalid && 'border-critical', className)} {...rest}>
      {children}
    </select>
  );
});

// ------------------------------------------------------------------ Layout pieces
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('rounded-2xl border border-hairline bg-surface shadow-[0_1px_3px_rgba(15,23,42,0.05)]', className)}>{children}</div>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-muted" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-plane p-3 text-ink-muted">{icon ?? <Inbox className="size-6" aria-hidden />}</div>
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-2">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <AlertCircle className="mb-2 size-6 text-critical" aria-hidden />
      <p className="text-sm text-ink">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Table
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={clsx('border-b border-hairline bg-plane/60 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-muted', className)}>{children}</th>
);
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={clsx('border-b border-hairline px-4 py-3 align-middle text-ink', className)}>{children}</td>
);

export function Pagination({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3 text-sm text-ink-2">
      <span className="tabular">
        Page {page} of {totalPages} · {total} records
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Modal
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={clsx(
          'max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl',
          size === 'sm' ? 'sm:max-w-sm' : size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {title}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-ink-muted hover:bg-black/5" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Stat tile
/** Decorative icon-chip colours for stat tiles (identity only — not status). */
const STAT_TONES = {
  indigo: 'bg-indigo-50 text-indigo-600',
  sky: 'bg-sky-50 text-sky-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  violet: 'bg-violet-50 text-violet-600',
  amber: 'bg-amber-50 text-amber-600',
} as const;

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = 'indigo',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: keyof typeof STAT_TONES;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-2">{label}</p>
        {icon && <span className={clsx('grid size-9 shrink-0 place-items-center rounded-xl', STAT_TONES[tone])}>{icon}</span>}
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-muted">{sub}</p>}
    </Card>
  );
}

export function KeyValue({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="text-ink-2">{label}</span>
      <span className={clsx('text-right tabular', strong ? 'font-semibold text-ink' : 'text-ink')}>{value}</span>
    </div>
  );
}
