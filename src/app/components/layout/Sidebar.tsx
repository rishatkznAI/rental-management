import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  CalendarClock,
  Car,
  Search,
  BadgeDollarSign,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions, type Section } from '../../lib/permissions';
import { NotificationCenter } from './NotificationCenter';
import { Input } from '../ui/input';
import { useEquipmentList } from '../../hooks/useEquipment';
import { useClientsList } from '../../hooks/useClients';
import { useRentalsList } from '../../hooks/useRentals';
import { useServiceTicketsList } from '../../hooks/useServiceTickets';
import type { Client, Equipment, Rental, ServiceTicket } from '../../types';

const navigation: { name: string; href: string; icon: React.ElementType; section: Section }[] = [
  { name: 'Дашборд',      href: '/',          icon: LayoutDashboard, section: 'dashboard'  },
  { name: 'Техника',      href: '/equipment', icon: Truck,           section: 'equipment'  },
  { name: 'Продажи',      href: '/sales',     icon: BadgeDollarSign, section: 'sales'      },
  { name: 'Аренды',       href: '/rentals',   icon: FileText,        section: 'rentals'    },
  { name: 'Планировщик',  href: '/planner',   icon: CalendarClock,   section: 'planner'    },
  { name: 'Сервис',       href: '/service',          icon: Wrench,        section: 'service'          },
  { name: 'Сл. машины',  href: '/service-vehicles', icon: Car,           section: 'service_vehicles' },
  { name: 'Клиенты',      href: '/clients',   icon: Users,           section: 'clients'    },
  { name: 'Документы',    href: '/documents', icon: FileCheck,       section: 'documents'  },
  { name: 'Платежи',      href: '/payments',  icon: CreditCard,      section: 'payments'   },
  { name: 'Отчёты',       href: '/reports',   icon: BarChart3,       section: 'reports'    },
  { name: 'Настройки',    href: '/settings',  icon: Settings,        section: 'settings'   },
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

type SearchResult = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  section: Section;
  group: 'Техника' | 'Клиенты' | 'Аренды' | 'Сервис';
  icon: React.ElementType;
};

function normalizeSearch(text: string): string {
  return text.trim().toLowerCase();
}

function includesSearch(haystack: Array<string | number | undefined>, needle: string): boolean {
  return haystack.some(value => String(value ?? '').toLowerCase().includes(needle));
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;

  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let startIndex = 0;
  let matchIndex = normalizedText.indexOf(normalizedQuery);

  while (matchIndex !== -1) {
    if (matchIndex > startIndex) {
      parts.push(text.slice(startIndex, matchIndex));
    }

    const endIndex = matchIndex + query.length;
    parts.push(
      <mark
        key={`${matchIndex}-${endIndex}`}
        className="rounded bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-500/30"
      >
        {text.slice(matchIndex, endIndex)}
      </mark>,
    );

    startIndex = endIndex;
    matchIndex = normalizedText.indexOf(normalizedQuery, startIndex);
  }

  if (startIndex < text.length) {
    parts.push(text.slice(startIndex));
  }

  return parts.length > 0 ? parts : text;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const { canView } = usePermissions();
  const { data: equipment = [] } = useEquipmentList();
  const { data: clients = [] } = useClientsList();
  const { data: rentals = [] } = useRentalsList();
  const { data: serviceTickets = [] } = useServiceTicketsList();
  const [search, setSearch] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const deferredSearch = useDeferredValue(search);
  const normalizedSearch = normalizeSearch(deferredSearch);

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

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!searchRef.current?.contains(event.target as Node)) {
        setIsSearchOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setIsSearchOpen(normalizedSearch.length > 0);
  }, [normalizedSearch]);

  const searchResults = useMemo(() => {
    if (!normalizedSearch) return [] as SearchResult[];

    const results: SearchResult[] = [];

    if (canView('equipment')) {
      for (const item of equipment as Equipment[]) {
        if (!includesSearch([
          item.inventoryNumber,
          item.manufacturer,
          item.model,
          item.serialNumber,
          item.location,
          item.currentClient,
        ], normalizedSearch)) continue;

        results.push({
          id: `equipment:${item.id}`,
          title: `${item.inventoryNumber} · ${item.manufacturer} ${item.model}`,
          subtitle: [item.serialNumber, item.location, item.status].filter(Boolean).join(' · '),
          href: `/equipment/${item.id}`,
          section: 'equipment',
          group: 'Техника',
          icon: Truck,
        });
      }
    }

    if (canView('clients')) {
      for (const item of clients as Client[]) {
        if (!includesSearch([
          item.company,
          item.inn,
          item.contact,
          item.phone,
          item.email,
          item.manager,
        ], normalizedSearch)) continue;

        results.push({
          id: `client:${item.id}`,
          title: item.company,
          subtitle: [item.contact, item.phone, item.inn].filter(Boolean).join(' · '),
          href: `/clients/${item.id}`,
          section: 'clients',
          group: 'Клиенты',
          icon: Users,
        });
      }
    }

    if (canView('rentals')) {
      for (const item of rentals as Rental[]) {
        if (!includesSearch([
          item.id,
          item.client,
          item.contact,
          item.manager,
          item.status,
          ...item.equipment,
        ], normalizedSearch)) continue;

        results.push({
          id: `rental:${item.id}`,
          title: `Аренда ${item.id}`,
          subtitle: [item.client, item.equipment.join(', '), item.startDate].filter(Boolean).join(' · '),
          href: `/rentals/${item.id}`,
          section: 'rentals',
          group: 'Аренды',
          icon: FileText,
        });
      }
    }

    if (canView('service')) {
      for (const item of serviceTickets as ServiceTicket[]) {
        if (!includesSearch([
          item.id,
          item.equipment,
          item.inventoryNumber,
          item.serialNumber,
          item.reason,
          item.description,
          item.assignedMechanicName,
          item.assignedTo,
          item.status,
        ], normalizedSearch)) continue;

        results.push({
          id: `service:${item.id}`,
          title: `${item.id} · ${item.equipment}`,
          subtitle: [item.reason, item.assignedMechanicName || item.assignedTo, item.status].filter(Boolean).join(' · '),
          href: `/service/${item.id}`,
          section: 'service',
          group: 'Сервис',
          icon: Wrench,
        });
      }
    }

    return results.slice(0, 12);
  }, [canView, clients, equipment, normalizedSearch, rentals, serviceTickets]);

  const groupedResults = useMemo(() => {
    const groups = new Map<SearchResult['group'], SearchResult[]>();
    for (const result of searchResults) {
      const group = groups.get(result.group) ?? [];
      group.push(result);
      groups.set(result.group, group);
    }
    return [...groups.entries()];
  }, [searchResults]);

  const handleSearchNavigate = (href: string) => {
    navigate(href);
    setSearch('');
    setIsSearchOpen(false);
    handleNavClick();
  };

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
            <NotificationCenter />
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

        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700" ref={searchRef}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onFocus={() => {
                if (normalizedSearch.length > 0) setIsSearchOpen(true);
              }}
              placeholder="Поиск: техника, клиенты, аренды, сервис"
              className="h-10 pl-9 pr-3 text-sm"
            />
          </div>

          {isSearchOpen && (
            <div className="mt-2 rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
              {searchResults.length === 0 ? (
                <div className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">
                  Ничего не найдено. Попробуйте номер техники, клиента, ID аренды или сервисной заявки.
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto py-2">
                  {groupedResults.map(([group, items]) => (
                    <div key={group}>
                      <div className="px-4 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                        {group}
                      </div>
                      <div className="space-y-1 px-2 pb-2">
                        {items.map((result) => {
                          const Icon = result.icon;
                          return (
                            <button
                              key={result.id}
                              type="button"
                              onClick={() => handleSearchNavigate(result.href)}
                              className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                              <div className="mt-0.5 rounded-md bg-gray-100 p-2 text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                                <Icon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-gray-900 dark:text-white">
                                  {highlightMatch(result.title, normalizedSearch)}
                                </div>
                                <div className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                                  {highlightMatch(result.subtitle, normalizedSearch)}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const isActive =
              location.pathname === item.href ||
              (item.href !== '/' && location.pathname.startsWith(item.href + '/'));

            return (
              <button
                key={item.name}
                type="button"
                onClick={() => {
                  navigate(item.href);
                  handleNavClick();
                }}
                className={cn(
                  'relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors',
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
              </button>
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
