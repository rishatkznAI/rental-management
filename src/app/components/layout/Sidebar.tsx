import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  LayoutDashboard,
  Truck,
  FileText,
  Wrench,
  Users,
  FileCheck,
  CreditCard,
  BarChart3,
  Settings,
  Moon,
  Sun,
  LogOut,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions, type Section } from '../../lib/permissions';

const navigation: { name: string; href: string; icon: React.ElementType; section: Section }[] = [
  { name: 'Дашборд',   href: '/',          icon: LayoutDashboard, section: 'dashboard'  },
  { name: 'Техника',   href: '/equipment', icon: Truck,           section: 'equipment'  },
  { name: 'Аренды',    href: '/rentals',   icon: FileText,        section: 'rentals'    },
  { name: 'Сервис',    href: '/service',   icon: Wrench,          section: 'service'    },
  { name: 'Клиенты',   href: '/clients',   icon: Users,           section: 'clients'    },
  { name: 'Документы', href: '/documents', icon: FileCheck,       section: 'documents'  },
  { name: 'Платежи',   href: '/payments',  icon: CreditCard,      section: 'payments'   },
  { name: 'Отчёты',    href: '/reports',   icon: BarChart3,       section: 'reports'    },
  { name: 'Настройки', href: '/settings',  icon: Settings,        section: 'settings'   },
];

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const { canView } = usePermissions();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const handleNavClick = () => {
    // Close mobile sidebar on navigation
    onClose();
  };

  // Показываем только те разделы, к которым у пользователя есть доступ
  const visibleNav = navigation.filter(item => canView(item.section));

  return (
    <aside
      className={cn(
        // Base styles
        'fixed left-0 top-0 z-40 h-screen w-64',
        'border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
        'transition-transform duration-300 ease-in-out',
        // Desktop: always visible
        'sm:translate-x-0',
        // Mobile: slide in/out
        isOpen ? 'translate-x-0' : '-translate-x-full sm:translate-x-0',
      )}
    >
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b border-gray-200 dark:border-gray-700 px-6">
          <div className="flex items-center">
            <Truck className="h-8 w-8 text-[--color-primary]" />
            <span className="ml-2 text-lg font-bold text-gray-900 dark:text-white">Подъёмники</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-label="Переключить тему"
            >
              {theme === 'light' ? (
                <Moon className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              ) : (
                <Sun className="h-5 w-5 text-gray-400" />
              )}
            </button>
            {/* Close button — mobile only */}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors sm:hidden"
              aria-label="Закрыть меню"
            >
              <X className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const isActive =
              location.pathname === item.href ||
              (item.href !== '/' && location.pathname.startsWith(item.href));

            return (
              <Link
                key={item.name}
                to={item.href}
                onClick={handleNavClick}
                className={cn(
                  'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'text-[--color-primary] bg-blue-50 dark:bg-blue-900/20'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {item.name}
                {isActive && (
                  <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-[--color-primary] rounded-full" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* User info + logout */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[--color-primary] text-white font-medium text-sm">
              {user ? getInitials(user.name) : '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {user?.name ?? '—'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {user?.role ?? 'Пользователь'}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-label="Выйти"
              title="Выйти"
            >
              <LogOut className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
