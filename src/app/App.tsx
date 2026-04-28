import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes';
import { Toaster } from 'sonner';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { AppLoadingState } from './components/ui/AppLoadingState';
import { BuildDebugBadge } from './components/ui/BuildDebugBadge';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // react-query re-fetches on window focus by default (refetchOnWindowFocus: true)
      // enabling this so migrated pages stay fresh across tabs
      refetchOnWindowFocus: true,
      staleTime: 1000 * 60 * 2, // 2 мин по умолчанию
    },
  },
});

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ThemeProvider>
            <RouterProvider
              router={router}
              fallbackElement={
                <AppLoadingState
                  title="Открываем раздел"
                  description="Загружаем интерфейс и данные."
                />
              }
            />
            <BuildDebugBadge />
            <Toaster position="top-right" />
          </ThemeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
