import { createHashRouter } from 'react-router-dom';
import { Layout } from './components/layout/Layout';

const pageModules = import.meta.glob('./pages/*.tsx');

async function loadErrorBoundary() {
  const importer = pageModules['./pages/ErrorPage.tsx'];
  if (!importer) {
    throw new Error('Unknown route module: ./pages/ErrorPage');
  }
  const module = await importer();
  return module.default;
}

function lazyPage(path: string) {
  return async () => {
    const importer = pageModules[`${path}.tsx`];
    if (!importer) {
      throw new Error(`Unknown route module: ${path}`);
    }
    const [module, ErrorBoundary] = await Promise.all([
      importer(),
      loadErrorBoundary(),
    ]);
    return {
      Component: module.default,
      ErrorBoundary,
    };
  };
}

// GitHub Pages is a static host, so hash routing is the most reliable way to
// avoid broken deep links and stale page shells on refresh/navigation.
export const router = createHashRouter([
  {
    path: '/login',
    lazy: lazyPage('./pages/Login'),
  },
  {
    path: '/',
    lazy: async () => ({
      Component: Layout,
      ErrorBoundary: await loadErrorBoundary(),
    }),
    children: [
      { index: true, lazy: lazyPage('./pages/Dashboard') },
      { path: 'planner', lazy: lazyPage('./pages/Planner') },
      { path: 'equipment', lazy: lazyPage('./pages/Equipment') },
      { path: 'equipment/new', lazy: lazyPage('./pages/EquipmentNew') },
      { path: 'equipment/:id', lazy: lazyPage('./pages/EquipmentDetail') },
      { path: 'gsm', lazy: lazyPage('./pages/Gsm') },
      { path: 'knowledge-base', lazy: lazyPage('./pages/KnowledgeBase') },
      { path: 'sales', lazy: lazyPage('./pages/Sales') },
      { path: 'deliveries', lazy: lazyPage('./pages/Deliveries') },
      { path: 'rentals', lazy: lazyPage('./pages/Rentals') },
      { path: 'rentals/new', lazy: lazyPage('./pages/RentalNew') },
      { path: 'rentals/:id', lazy: lazyPage('./pages/RentalDetail') },
      { path: 'service', lazy: lazyPage('./pages/Service') },
      { path: 'service/new', lazy: lazyPage('./pages/ServiceNew') },
      { path: 'service/:id', lazy: lazyPage('./pages/ServiceDetail') },
      { path: 'clients', lazy: lazyPage('./pages/Clients') },
      { path: 'clients/new', lazy: lazyPage('./pages/ClientNew') },
      { path: 'clients/:id', lazy: lazyPage('./pages/ClientDetail') },
      { path: 'documents', lazy: lazyPage('./pages/Documents') },
      { path: 'payments', lazy: lazyPage('./pages/Payments') },
      { path: 'finance', lazy: lazyPage('./pages/Finance') },
      { path: 'approvals', lazy: lazyPage('./pages/Approvals') },
      { path: 'bots', lazy: lazyPage('./pages/Bots') },
      { path: 'bots/:botId', lazy: lazyPage('./pages/BotDetail') },
      { path: 'reports', lazy: lazyPage('./pages/Reports') },
      { path: 'settings', lazy: lazyPage('./pages/ProfileSettings') },
      { path: 'admin', lazy: lazyPage('./pages/AdminPanel') },
      { path: 'service-vehicles', lazy: lazyPage('./pages/ServiceVehicles') },
      { path: 'service-vehicles/:id', lazy: lazyPage('./pages/ServiceVehicleDetail') },
      { path: 'manager-report', lazy: lazyPage('./pages/ManagerReport') },
    ],
  },
]);
