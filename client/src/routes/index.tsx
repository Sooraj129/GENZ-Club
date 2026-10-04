import { lazy } from 'react';
import { Navigate, Outlet, createBrowserRouter, useLocation } from 'react-router';
import { Spinner } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { SocketProvider } from '../contexts/SocketContext';
import { AppLayout } from '../layouts/AppLayout';
import LoginPage from '../pages/LoginPage';

// Pages load on demand so the chart library only ships with the pages that use it.
const ActiveSessionsPage = lazy(() => import('../pages/ActiveSessionsPage'));
const ConsolesPage = lazy(() => import('../pages/ConsolesPage'));
const CustomerDetailPage = lazy(() => import('../pages/CustomerDetailPage'));
const CustomersPage = lazy(() => import('../pages/CustomersPage'));
const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const InvoiceDetailPage = lazy(() => import('../pages/InvoiceDetailPage'));
const InvoicesPage = lazy(() => import('../pages/InvoicesPage'));
const MembershipsPage = lazy(() => import('../pages/MembershipsPage'));
const NewSessionPage = lazy(() => import('../pages/NewSessionPage'));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'));
const PaymentsPage = lazy(() => import('../pages/PaymentsPage'));
const ReportsPage = lazy(() => import('../pages/ReportsPage'));
const SessionHistoryPage = lazy(() => import('../pages/SessionHistoryPage'));
const SettingsPage = lazy(() => import('../pages/SettingsPage'));
const UsersPage = lazy(() => import('../pages/UsersPage'));

function RequireAuth() {
  const { user, loading, token } = useAuth();
  const location = useLocation();
  if (loading || (token && !user)) return <Spinner label="Restoring your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <SocketProvider>
      <Outlet />
    </SocketProvider>
  );
}

function RequireAdmin() {
  const { isAdmin } = useAuth();
  return isAdmin ? <Outlet /> : <Navigate to="/" replace />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'sessions/new', element: <NewSessionPage /> },
          { path: 'sessions/active', element: <ActiveSessionsPage /> },
          { path: 'sessions/history', element: <SessionHistoryPage /> },
          { path: 'customers', element: <CustomersPage /> },
          { path: 'customers/:id', element: <CustomerDetailPage /> },
          { path: 'consoles', element: <ConsolesPage /> },
          { path: 'memberships', element: <MembershipsPage /> },
          { path: 'invoices', element: <InvoicesPage /> },
          { path: 'invoices/:id', element: <InvoiceDetailPage /> },
          { path: 'payments', element: <PaymentsPage /> },
          {
            element: <RequireAdmin />,
            children: [
              { path: 'reports', element: <ReportsPage /> },
              { path: 'users', element: <UsersPage /> },
              { path: 'settings', element: <SettingsPage /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
