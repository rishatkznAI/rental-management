import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes';
import { Toaster } from 'sonner';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { AppLoadingState } from './components/ui/AppLoadingState';
import { AppDisabledScreen } from './components/ui/AppDisabledScreen';
import { BuildDebugBadge } from './components/ui/BuildDebugBadge';
import { DemoModeBadge } from './components/ui/DemoModeBadge';
import { animationClasses } from './lib/animations';

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

function AppGate() {
  const { appDisabled } = useAuth();
  if (appDisabled) {
    return <AppDisabledScreen message={appDisabled.message} />;
  }
  return (
    <>
      <RouterProvider
        router={router}
        fallbackElement={
          <AppLoadingState
            title="Открываем раздел"
            description="Загружаем интерфейс и данные."
          />
        }
      />
      <DemoModeBadge />
      <BuildDebugBadge />
      <Toaster
        position="top-right"
        richColors
        closeButton
        toastOptions={{
          classNames: {
            toast: animationClasses.toast,
          },
        }}
      />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ThemeProvider>
            <AppGate />
          </ThemeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
