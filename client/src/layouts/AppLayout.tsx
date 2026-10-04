/**
 * App shell: sidebar navigation + top bar + page content.
 *
 * Sidebar behaviour
 *   Desktop (≥ lg): toggle between full (labels) and collapsed (icons only).
 *                   The choice is remembered in localStorage ('gc_sidebar').
 *   Mobile:         the same toggle opens/closes a slide-in drawer.
 */
import clsx from 'clsx';
import {
  BadgePercent,
  BarChart3,
  CalendarPlus,
  CreditCard,
  Gamepad2,
  History,
  LayoutDashboard,
  LogOut,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Settings,
  Timer,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Spinner } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useSocketStatus } from '../contexts/SocketContext';
import { useServerNow } from '../hooks/useServerNow';
import { formatDate, formatTime } from '../utils/format';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  adminOnly?: boolean;
}

const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Front desk',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/sessions/new', label: 'New Session', icon: CalendarPlus },
      { to: '/sessions/active', label: 'Active Sessions', icon: Timer },
      { to: '/sessions/history', label: 'Session History', icon: History },
      { to: '/customers', label: 'Customers', icon: Users },
      { to: '/memberships', label: 'Memberships', icon: BadgePercent },
    ],
  },
  {
    title: 'Billing',
    items: [
      { to: '/invoices', label: 'Invoices', icon: Receipt },
      { to: '/payments', label: 'Payments', icon: CreditCard },
      { to: '/reports', label: 'Reports', icon: BarChart3, adminOnly: true },
    ],
  },
  {
    title: 'Manage',
    items: [
      { to: '/consoles', label: 'Consoles', icon: Monitor },
      { to: '/users', label: 'Users', icon: UserCog, adminOnly: true },
      { to: '/settings', label: 'Settings', icon: Settings, adminOnly: true },
    ],
  },
];

const SIDEBAR_KEY = 'gc_sidebar';
const readCollapsed = () => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
  } catch {
    return false;
  }
};

/** "Live" when Socket.IO is connected; otherwise data may be stale. */
function ConnectionPill({ compact = false }: { compact?: boolean }) {
  const live = useSocketStatus() === 'connected';
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full text-xs font-medium',
        !compact && 'px-2.5 py-1 ring-1 ring-inset',
        live ? 'text-emerald-700 ring-emerald-600/20 bg-emerald-50' : 'text-amber-800 ring-amber-600/30 bg-amber-50',
        compact && 'bg-transparent',
      )}
      title={live ? 'Receiving live updates' : 'Reconnecting — data may be stale'}
    >
      <span className={clsx('size-2 rounded-full', live ? 'bg-emerald-500' : 'animate-pulse bg-amber-500')} aria-hidden />
      {!compact && (live ? 'Live' : 'Reconnecting')}
    </span>
  );
}

/** Business date & time (IST, server-aligned) shown in the top bar. */
function ServerClock() {
  const now = useServerNow();
  return (
    <span className="hidden text-sm text-ink-2 tabular sm:inline">
      {formatDate(new Date(now))} · {formatTime(new Date(now))}
    </span>
  );
}

function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { user, logout, isAdmin } = useAuth();
  const initials = (user?.name ?? '?').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-nav to-nav-2 text-slate-300">
      {/* Brand */}
      <div className={clsx('flex items-center gap-3 py-5', collapsed ? 'justify-center px-2' : 'px-5')}>
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-fuchsia-500 text-white shadow-lg shadow-brand-500/30">
          <Gamepad2 className="size-5" aria-hidden />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">Game Center</p>
            <p className="text-xs text-slate-400">PlayStation lounge</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="scroll-dark flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Main">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((i) => !i.adminOnly || isAdmin);
          if (!items.length) return null;
          return (
            <div key={group.title}>
              {!collapsed && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{group.title}</p>}
              <div className="space-y-0.5">
                {items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={onNavigate}
                    title={collapsed ? label : undefined}
                    className={({ isActive }) =>
                      clsx(
                        'group relative flex items-center gap-3 rounded-lg py-2 text-sm transition-colors',
                        collapsed ? 'justify-center px-2' : 'px-3',
                        isActive ? 'bg-white/10 font-medium text-white' : 'hover:bg-white/5 hover:text-white',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-brand-400" aria-hidden />}
                        <Icon className={clsx('size-[18px] shrink-0', isActive ? 'text-brand-400' : 'text-slate-400 group-hover:text-slate-200')} aria-hidden />
                        {!collapsed && <span className="truncate">{label}</span>}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Signed-in user */}
      <div className={clsx('border-t border-white/10 p-3', collapsed && 'flex flex-col items-center')}>
        <div className={clsx('flex items-center gap-3', collapsed ? 'justify-center' : 'px-2')}>
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-600/30 text-xs font-semibold text-brand-200" title={user?.name}>
            {initials}
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{user?.name}</p>
              <p className="truncate text-xs text-slate-400">{user?.role === 'ADMIN' ? 'Administrator' : 'Staff'}</p>
            </div>
          )}
        </div>
        <button
          onClick={() => void logout()}
          title="Log out"
          className={clsx('mt-3 flex items-center gap-2 rounded-lg py-2 text-sm text-slate-400 hover:bg-white/5 hover:text-white', collapsed ? 'justify-center px-2' : 'w-full px-3')}
        >
          <LogOut className="size-4" aria-hidden />
          {!collapsed && 'Log out'}
        </button>
      </div>
    </div>
  );
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  // One button: collapses the sidebar on desktop, opens the drawer on mobile.
  const toggle = () => {
    if (window.matchMedia('(min-width: 1024px)').matches) setCollapsed((c) => !c);
    else setMobileOpen((o) => !o);
  };

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className={clsx('no-print hidden shrink-0 transition-[width] duration-200 lg:block', collapsed ? 'w-[76px]' : 'w-64')}>
        <Sidebar collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-2xl">
            <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="no-print flex h-14 shrink-0 items-center gap-3 border-b border-hairline bg-white/80 px-4 backdrop-blur sm:px-6">
          <button
            onClick={toggle}
            className="rounded-lg p-2 text-ink-2 hover:bg-plane hover:text-ink"
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
            title="Toggle menu"
          >
            <span className="hidden lg:inline">{collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}</span>
            <span className="lg:hidden">{mobileOpen ? <PanelLeftClose className="size-5" /> : <PanelLeftOpen className="size-5" />}</span>
          </button>
          <span className="font-semibold text-ink lg:hidden">Game Center</span>
          <div className="ml-auto flex items-center gap-4">
            <ServerClock />
            <ConnectionPill />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <Suspense fallback={<Spinner />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
