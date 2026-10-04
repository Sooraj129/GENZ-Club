import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { errorStatus } from './api/client';
import { AuthProvider } from './contexts/AuthContext';
import { router } from './routes';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Don't hammer the API on client errors (validation, permissions, not found).
      retry: (count, err) => {
        const status = errorStatus(err);
        return !(status && status >= 400 && status < 500) && count < 2;
      },
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}
