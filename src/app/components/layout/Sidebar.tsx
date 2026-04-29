import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  Route,
  Bot,
  MapPinned,
  GraduationCap,
  Shield,
  UserCog,
  WalletCards,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions, type Section } from '../../lib/permissions';
import {
  DEFAULT_SIDEBAR_ORDER,
  SIDEBAR_NAV_GROUP_SETTING_KEY,
  SIDEBAR_NAV_GROUPS,
  normalizeSidebarGroups,
  normalizeSidebarOrder,
} from '../../lib/navigation';
import { getInvestorBinding, isInvestorUser } from '../../lib/userStorage';
import { NotificationCenter } from './NotificationCenter';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { useEquipmentList } from '../../hooks/useEquipment';
import { useClientsList } from '../../hooks/useClients';
import { useGanttData, useRentalsList } from '../../hooks/useRentals';
import { useServiceTicketsList } from '../../hooks/useServiceTickets';
import { appSettingsService } from '../../services/app-settings.service';
import type { Client, Equipment, Rental, ServiceTicket } from '../../types';
import { LiftLogo } from './LiftLogo';

const navigation: { name: string; href: string; icon: React.ElementType; section: Section }[] = [
  { name: 'Дашборд',      href: '/',          icon: LayoutDashboard, section: 'dashboard'  },
  { name: 'Техника',      href: '/equipment', icon: Truck,           section: 'equipment'  },
  { name: 'GSM',          href: '/gsm',       icon: MapPinned,       section: 'gsm'        },
  { name: 'База знаний',  href: '/knowledge-base', icon: GraduationCap, section: 'knowledge_base' },
  { name: 'Продажи',      href: '/sales',     icon: BadgeDollarSign, section: 'sales'      },
  { name: 'Доставка',     href: '/deliveries',icon: Route,           section: 'deliveries' },
  { name: 'Аренды',       href: '/rentals',   icon: FileText,        section: 'rentals'    },
  { name: 'Планировщик',  href: '/planner',   icon: CalendarClock,   section: 'planner'    },
  { name: 'Сервис',       href: '/service',          icon: Wrench,        section: 'service'          },
  { name: 'Сл. машины',  href: '/service-vehicles', icon: Car,           section: 'service_vehicles' },
  { name: 'Клиенты',      href: '/clients',   icon: Users,           section: 'clients'    },
  { name: 'Документы',    href: '/documents', icon: FileCheck,       section: 'documents'  },
  { name: 'Платежи',      href: '/payments',  icon: CreditCard,      section: 'payments'   },
  { name: 'Финансы',      href: '/finance',   icon: WalletCards,     section: 'finance'    },
  { name: 'Бот',          href: '/bots',      icon: Bot,             section: 'bots'       },
  { name: 'Отчёты',       href: '/reports',   icon: BarChart3,       section: 'reports'    },
  { name: 'Личные настройки', href: '/settings', icon: UserCog,      section: 'profile_settings' },
  { name: 'Панель администратора', href: '/admin', icon: Shield,     section: 'admin_panel' },
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
  const { data: ganttRentals = [] } = useGanttData();
  const { data: serviceTickets = [] } = useServiceTicketsList();
  const { data: appSettings = [] } = useQuery({
    queryKey: ['app-settings'],
    queryFn: appSettingsService.getAll,
    staleTime: 1000 * 60 * 5,
  });
  const [search, setSearch] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const deferredSearch = useDeferredValue(search);
  const normalizedSearch = normalizeSearch(deferredSearch);
  const investorBinding = useMemo(() => getInvestorBinding(user), [user]);
  const isInvestorRole = isInvestorUser({
    role: user?.role,
    status: 'Активен',
    ownerId: user?.ownerId,
    ownerName: user?.ownerName,
    name: user?.name,
  });
  const investorEquipmentIds = useMemo(() => {
    if (!isInvestorRole || !investorBinding) return null;
    return new Set(
      (equipment as Equipment[])
        .filter(item =>
          item.owner === 'investor'
          && (
            (investorBinding.ownerId && item.ownerId === investorBinding.ownerId)
            || (investorBinding.ownerName && (item.ownerName || '').trim() === investorBinding.ownerName)
          ),
        )
        .map(item => item.id),
    );
  }, [equipment, investorBinding, isInvestorRole]);
  const investorInventoryNumbers = useMemo(() => {
    if (!isInvestorRole || !investorBinding) return null;
    return new Set(
      (equipment as Equipment[])
        .filter(item =>
          item.owner === 'investor'
          && (
            (investorBinding.ownerId && item.ownerId === investorBinding.ownerId)
            || (investorBinding.ownerName && (item.ownerName || '').trim() === investorBinding.ownerName)
          ),
        )
        .map(item => item.inventoryNumber),
    );
  }, [equipment, investorBinding, isInvestorRole]);
  const visibleRentals = useMemo(() => {
    if (!isInvestorRole || !investorEquipmentIds || !investorInventoryNumbers) return rentals as Rental[];
    const allowedRentalIds = new Set(
      ganttRentals
        .filter(item =>
          (item.equipmentId && investorEquipmentIds.has(item.equipmentId))
          || investorInventoryNumbers.has(item.equipmentInv),
        )
        .map(item => item.id),
    );
    return (rentals as Rental[]).filter(item =>
      allowedRentalIds.has(item.id)
      || item.equipment.some(label => investorInventoryNumbers.has(label)),
    );
  }, [ganttRentals, investorEquipmentIds, investorInventoryNumbers, isInvestorRole, rentals]);
  const visibleGanttRentals = useMemo(() => {
    if (!isInvestorRole || !investorEquipmentIds || !investorInventoryNumbers) return ganttRentals;
    return ganttRentals.filter(item =>
      (item.equipmentId && investorEquipmentIds.has(item.equipmentId))
      || investorInventoryNumbers.has(item.equipmentInv),
    );
  }, [ganttRentals, investorEquipmentIds, investorInventoryNumbers, isInvestorRole]);

  const navBadges = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);

    return {
      equipment: equipment.filter(item => item.status === 'in_service' || item.status === 'inactive').length,
      rentals: visibleGanttRentals.filter(item =>
        (item.status === 'active' || item.status === 'created')
        && item.endDate <= todayKey,
      ).length,
      service: serviceTickets.filter(item => item.status !== 'closed').length,
      documents: 0,
      payments: 0,
    };
  }, [equipment, serviceTickets, visibleGanttRentals]);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const handleNavClick = () => {
    // Close mobile sidebar on navigation
    onClose();
  };

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
      for (const item of visibleRentals) {
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
  }, [canView, clients, equipment, normalizedSearch, serviceTickets, visibleRentals]);

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

  const sidebarOrder = useMemo(() => {
    const orderSetting = appSettings.find(item => item.key === 'sidebar_navigation_order');
    return normalizeSidebarOrder(orderSetting?.value);
  }, [appSettings]);
  const sidebarGroups = useMemo(() => {
    const groupSetting = appSettings.find(item => item.key === SIDEBAR_NAV_GROUP_SETTING_KEY);
    return normalizeSidebarGroups(groupSetting?.value);
  }, [appSettings]);
  const orderIndex = useMemo(() => {
    const next = new Map<Section, number>();
    sidebarOrder.forEach((section, index) => next.set(section, index));
    DEFAULT_SIDEBAR_ORDER.forEach((section, index) => {
      if (!next.has(section)) next.set(section, sidebarOrder.length + index);
    });
    return next;
  }, [sidebarOrder]);

  const groupedNav = SIDEBAR_NAV_GROUPS.map(group => ({
    ...group,
    items: navigation
      .filter(item =>
        sidebarGroups[item.section] === group.id
        && canView(item.section)
      )
      .sort((a, b) => (orderIndex.get(a.section) ?? 999) - (orderIndex.get(b.section) ?? 999)),
  })).filter(group => group.items.length > 0);

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen w-64',
        'border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-[0_36px_60px_-34px_rgba(0,0,0,0.7)] backdrop-blur-xl',
        'transition-transform duration-300 ease-in-out',
        'sm:translate-x-0',
        isOpen ? 'translate-x-0' : '-translate-x-full sm:translate-x-0',
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-sidebar-border px-4 py-4">
          <LiftLogo className="h-9 w-9" />
          <div className="min-w-0">
            <div className="app-shell-title text-[15px] font-extrabold text-sidebar-foreground">Скайтех</div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/60">
              <NotificationCenter />
            </div>
            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              aria-label="Переключить тему"
            >
              {theme === 'light' ? (
                <Moon className="h-4 w-4" />
              ) : (
                <Sun className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground sm:hidden"
              aria-label="Закрыть меню"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="px-3 py-3" ref={searchRef}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onFocus={() => {
                if (normalizedSearch.length > 0) setIsSearchOpen(true);
              }}
              placeholder="Поиск: техника, клиенты, аренды, сервис"
              className="h-10 rounded-xl border-sidebar-border bg-sidebar-accent pl-9 pr-3 text-sm text-sidebar-foreground placeholder:text-muted-foreground"
            />
          </div>

          {isSearchOpen && (
            <div className="mt-2 rounded-2xl border border-sidebar-border bg-card shadow-[0_24px_45px_-30px_rgba(0,0,0,0.85)]">
              {searchResults.length === 0 ? (
                <div className="px-4 py-4 text-sm text-muted-foreground">
                  Ничего не найдено. Попробуйте номер техники, клиента, ID аренды или сервисной заявки.
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto py-2">
                  {groupedResults.map(([group, items]) => (
                    <div key={group}>
                      <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
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
                              className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left hover:bg-sidebar-accent"
                            >
                              <div className="mt-0.5 rounded-lg bg-sidebar-accent p-2 text-muted-foreground">
                                <Icon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-sidebar-foreground">
                                  {highlightMatch(result.title, normalizedSearch)}
                                </div>
                                <div className="line-clamp-2 text-xs text-muted-foreground">
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

        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {groupedNav.map(group => (
            <div key={group.title} className="mb-2">
              <div className="px-3 pb-1 pt-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {group.title}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    location.pathname === item.href ||
                    (item.href !== '/' && location.pathname.startsWith(item.href + '/'));
                  const badgeValue = navBadges[item.section as keyof typeof navBadges];

                  return (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => {
                        navigate(item.href);
                        handleNavClick();
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] transition-colors',
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-[0_16px_30px_-22px_rgba(212,247,74,0.95)]'
                          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1">{item.name}</span>
                      {typeof badgeValue === 'number' && badgeValue > 0 ? (
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-medium',
                          isActive
                            ? 'bg-black/15 text-primary-foreground'
                            : item.section === 'service'
                              ? 'bg-orange-500/12 text-orange-400'
                              : 'bg-emerald-500/12 text-emerald-400',
                        )}>
                          {badgeValue > 99 ? '99+' : badgeValue}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border px-3 pb-3 pt-2">
          <div className={cn(
            'mb-2 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
            theme === 'dark'
              ? 'border-sidebar-border bg-sidebar-accent text-sidebar-foreground'
              : 'border-sidebar-border bg-sidebar-accent/80 text-muted-foreground',
          )}>
            {theme === 'dark' ? <Moon className="h-4 w-4 text-sidebar-foreground" /> : <Sun className="h-4 w-4 text-muted-foreground" />}
            <span>{theme === 'dark' ? 'Тёмный режим' : 'Светлый режим'}</span>
            <button
              type="button"
              onClick={toggleTheme}
              aria-pressed={theme === 'dark'}
              className={cn(
                'ml-auto inline-flex h-6 w-12 items-center rounded-full border p-1 transition-all',
                theme === 'dark'
                  ? 'justify-end border-primary/30 bg-primary/90 text-primary-foreground shadow-[0_10px_24px_-18px_rgba(212,247,74,0.95)]'
                  : 'justify-start border-sidebar-border bg-accent text-muted-foreground hover:border-primary/30',
              )}
            >
              <span className={cn(
                'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none transition-colors',
                theme === 'dark'
                  ? 'bg-black/20 text-primary-foreground'
                  : 'bg-muted/80 text-foreground',
              )}>
                {theme === 'dark' ? 'On' : 'Off'}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-sidebar-border bg-sidebar-accent/80 px-3 py-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {user?.profilePhoto ? (
                <img src={user.profilePhoto} alt={user.name} className="h-10 w-10 rounded-full object-cover" />
              ) : (
                user ? getInitials(user.name) : '?'
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-sidebar-foreground">
                {user?.name ?? '—'}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {user?.role ?? 'Пользователь'}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-sidebar-foreground"
              aria-label="Выйти"
              title="Выйти"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
