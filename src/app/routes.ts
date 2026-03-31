import { createBrowserRouter } from 'react-router';
import { Layout } from './components/layout/Layout';
import { PrivateRoute } from './components/auth/PrivateRoute';
import Dashboard from './pages/Dashboard';
import Equipment from './pages/Equipment';
import EquipmentNew from './pages/EquipmentNew';
import EquipmentDetail from './pages/EquipmentDetail';
import Rentals from './pages/Rentals';
import RentalNew from './pages/RentalNew';
import RentalDetail from './pages/RentalDetail';
import Service from './pages/Service';
import ServiceNew from './pages/ServiceNew';
import ServiceDetail from './pages/ServiceDetail';
import Clients from './pages/Clients';
import ClientNew from './pages/ClientNew';
import ClientDetail from './pages/ClientDetail';
import Documents from './pages/Documents';
import Payments from './pages/Payments';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Login from './pages/Login';

export const router = createBrowserRouter([
  {
    path: '/login',
    Component: Login,
  },
  {
    path: '/',
    Component: PrivateRoute,
    children: [
      {
        Component: Layout,
        children: [
          { index: true, Component: Dashboard },
          { path: 'equipment', Component: Equipment },
          { path: 'equipment/new', Component: EquipmentNew },
          { path: 'equipment/:id', Component: EquipmentDetail },
          { path: 'rentals', Component: Rentals },
          { path: 'rentals/new', Component: RentalNew },
          { path: 'rentals/:id', Component: RentalDetail },
          { path: 'service', Component: Service },
          { path: 'service/new', Component: ServiceNew },
          { path: 'service/:id', Component: ServiceDetail },
          { path: 'clients', Component: Clients },
          { path: 'clients/new', Component: ClientNew },
          { path: 'clients/:id', Component: ClientDetail },
          { path: 'documents', Component: Documents },
          { path: 'payments', Component: Payments },
          { path: 'reports', Component: Reports },
          { path: 'settings', Component: Settings },
        ],
      },
    ],
  },
]);
