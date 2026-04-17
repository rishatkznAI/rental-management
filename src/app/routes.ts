import { createBrowserRouter } from 'react-router';
import { Layout } from './components/layout/Layout';
import { PrivateRoute } from './components/auth/PrivateRoute';
import Dashboard from './pages/Dashboard';
import Planner from './pages/Planner';
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
import ServiceVehicles from './pages/ServiceVehicles';
import ServiceVehicleDetail from './pages/ServiceVehicleDetail';
import ManagerReport from './pages/ManagerReport';
import ErrorPage from './pages/ErrorPage';

const basename = import.meta.env.BASE_URL || '/';

export const router = createBrowserRouter([
  {
    path: '/login',
    Component: Login,
    ErrorBoundary: ErrorPage,
  },
  {
    path: '/',
    Component: PrivateRoute,
    ErrorBoundary: ErrorPage,
    children: [
      {
        Component: Layout,
        children: [
          { index: true, Component: Dashboard },
          { path: 'planner', Component: Planner },
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
          { path: 'settings',                      Component: Settings          },
          { path: 'service-vehicles',              Component: ServiceVehicles      },
          { path: 'service-vehicles/:id',          Component: ServiceVehicleDetail },
          { path: 'manager-report',                Component: ManagerReport        },
        ],
      },
    ],
  },
], { basename });
