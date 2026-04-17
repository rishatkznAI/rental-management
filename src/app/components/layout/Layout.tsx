import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router';
import { Sidebar } from './Sidebar';
import { LayoutDashboard, Truck, FileText, Wrench, Users, Menu } from 'lucide-react';
import { cn } from '../../lib/utils';
import { NotificationCenter } from './NotificationCenter';

const BOTTOM_NAV = [
  { name: 'Дашборд', href: '/', icon: LayoutDashboard },
  { name: 'Техника', href: '/equipment', icon: Truck },
  { name: 'Аренды', href: '/rentals', icon: FileText },
  { name: 'Сервис', href: '/service', icon: Wrench },
  { name: 'Клиенты', href: '/clients', icon: Users },
];

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Desktop sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 sm:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile top bar */}
      <header className="fixed top-0 left-0 right-0 z-20 flex h-14 items-center justify-between border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 sm:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label="Открыть меню"
        >
          <Menu className="h-5 w-5 text-gray-700 dark:text-gray-300" />
        </button>
        <div className="flex items-center gap-2">
          <Truck className="h-6 w-6 text-[--color-primary]" />
          <span className="text-base font-bold text-gray-900 dark:text-white">Подъёмники</span>
        </div>
        <NotificationCenter />
      </header>

      {/* Main content */}
      <main className={cn(
        'min-h-screen',
        // Desktop: always offset by sidebar
        'sm:ml-64',
        // Mobile: extra top padding for top bar, bottom padding for bottom nav
        'pt-14 pb-16 sm:pt-0 sm:pb-0',
      )}>
        <Outlet key={location.pathname} />
      </main>

      {/* Mobile bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 sm:hidden">
        <div className="grid grid-cols-5">
          {BOTTOM_NAV.map((item) => {
            const Icon = item.icon;
            const isActive =
              location.pathname === item.href ||
              (item.href !== '/' && location.pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-[10px] font-medium transition-colors',
                  isActive
                    ? 'text-[--color-primary]'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                )}
              >
                <Icon className={cn('h-5 w-5', isActive && 'text-[--color-primary]')} />
                <span className="leading-none">{item.name}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
