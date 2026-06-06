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
  PanelLeftClose,
  PanelLeftOpen,
  Moon,
  Sun,
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
  WalletCards,
  ListChecks,
  Banknote,
  BriefcaseBusiness,
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
import { buildGlobalSearchGroups, normalizeGlobalSearchQuery } from '../../lib/globalSearch.js';
import { Input } from '../ui/input';
import { useEquipmentList } from '../../hooks/useEquipment';
import { useClientsList } from '../../hooks/useClients';
import { useGanttData, useRentalsList } from '../../hooks/useRentals';
import { useServiceTicketsList } from '../../hooks/useServiceTickets';
import { isRegularServiceTicket } from '../../lib/serviceTicketKind.js';
import { documentsService } from '../../services/documents.service';
import { paymentsService } from '../../services/payments.service';
import { deliveriesService } from '../../services/deliveries.service';
import { debtCollectionPlansService } from '../../services/debt-collection-plans.service';
import { appSettingsService } from '../../services/app-settings.service';
import { APP_BRAND_NAME } from '../../lib/appBrand';
import type { Equipment, Rental } from '../../types';
import { LiftLogo } from './LiftLogo';

const navigation: { name: string; href: string; icon: React.ElementType; section: Section }[] = [
  { name: 'Дашборд',      href: '/',          icon: LayoutDashboard, section: 'dashboard'  },
  { name: 'Центр задач',  href: '/tasks',     icon: ListChecks,      section: 'tasks_center' },
  { name: 'Техника',      href: '/equipment', icon: Truck,           section: 'equipment'  },
  { name: 'GSM',          href: '/gsm',       icon: MapPinned,       section: 'gsm'        },
  { name: 'База знаний',  href: '/knowledge-base', icon: GraduationCap, section: 'knowledge_base' },
  { name: 'CRM',          href: '/crm',       icon: BriefcaseBusiness, section: 'crm'        },
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
  { name: 'Зарплата',     href: '/payroll',   icon: Banknote,        section: 'payroll'    },
  { name: 'Бот',          href: '/bots',      icon: Bot,             section: 'bots'       },
  { name: 'Отчёты',       href: '/reports',   icon: BarChart3,       section: 'reports'    },
  { name: 'Панель администратора', href: '/admin', icon: Shield,     section: 'admin_panel' },
];

const ADMIN_REFERENCE_SECTIONS = new Set<Section>([
  'dashboard',
  'equipment',
  'gsm',
  'knowledge_base',
  'sales',
  'deliveries',
  'rentals',
  'planner',
  'service',
  'service_vehicles',
  'clients',
  'documents',
  'payments',
  'finance',
  'bots',
  'reports',
  'admin_panel',
  'profile_settings',
]);

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  desktopCollapsed?: boolean;
  onToggleDesktopCollapse?: () => void;
}

type SearchResult = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  section: Section;
  group: 'Техника' | 'Клиенты' | 'Аренды' | 'Документы' | 'Сервис' | 'Платежи' | 'Доставка' | 'Планы взыскания';
  icon: keyof typeof SEARCH_ICONS;
};

type SearchGroup = {
  group: SearchResult['group'];
  items: SearchResult[];
  total: number;
  hiddenCount: number;
};

const SEARCH_ICONS = {
  truck: Truck,
  users: Users,
  fileText: FileText,
  fileCheck: FileCheck,
  wrench: Wrench,
  creditCard: CreditCard,
  route: Route,
  listChecks: ListChecks,
} as const;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debouncedValue;
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

export function Sidebar({
  isOpen,
  onClose,
  desktopCollapsed = false,
  onToggleDesktopCollapse,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const { can, canView } = usePermissions();
  const isAdminReferenceMode = location.pathname === '/admin' || location.pathname.startsWith('/admin/');
  const canSearchEquipment = canView('equipment');
  const canSearchClients = canView('clients');
  const canSearchRentals = canView('rentals');
  const canSearchService = canView('service');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 180);
  const deferredSearch = useDeferredValue(debouncedSearch);
  const hasSearchInput = deferredSearch.trim().length > 0;
  const { data: equipment = [] } = useEquipmentList({ enabled: hasSearchInput && canSearchEquipment });
  const { data: clients = [] } = useClientsList({ enabled: hasSearchInput && canSearchClients });
  const { data: rentals = [] } = useRentalsList({ enabled: hasSearchInput && canSearchRentals });
  const { data: ganttRentals = [] } = useGanttData({ enabled: hasSearchInput && canSearchRentals });
  const { data: serviceTickets = [] } = useServiceTicketsList({ enabled: hasSearchInput && canSearchService });
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const { data: documents = [] } = useQuery({
    queryKey: ['documents', 'global-search', deferredSearch],
    queryFn: async () => (await documentsService.getReferences({
      page: 1,
      pageSize: 25,
      search: deferredSearch,
    })).items,
    enabled: hasSearchInput && canView('documents'),
    staleTime: 1000 * 60 * 5,
  });
  const { data: payments = [] } = useQuery({
    queryKey: ['payments', 'global-search'],
    queryFn: paymentsService.getAll,
    enabled: hasSearchInput && (canView('payments') || can('view', 'finance')),
    staleTime: 1000 * 60 * 2,
  });
  const { data: deliveries = [] } = useQuery({
    queryKey: ['deliveries', 'global-search', user?.id || 'anonymous', user?.role || 'anonymous'],
    queryFn: deliveriesService.getAll,
    enabled: hasSearchInput && canView('deliveries'),
    staleTime: 1000 * 60 * 2,
  });
  const { data: debtPlanResponse } = useQuery({
    queryKey: ['debt_collection_plans', 'global-search'],
    queryFn: debtCollectionPlansService.getAll,
    enabled: hasSearchInput && canView('finance'),
    staleTime: 1000 * 60 * 2,
  });
  const canReadAppSettings = canView('admin_panel');
  const { data: appSettings = [] } = useQuery({
    queryKey: ['app-settings'],
    queryFn: appSettingsService.getAll,
    enabled: canReadAppSettings,
    staleTime: 1000 * 60 * 5,
  });
  const normalizedSearch = normalizeGlobalSearchQuery(deferredSearch);
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
      service: serviceTickets.filter(item => isRegularServiceTicket(item) && item.status !== 'closed').length,
      documents: 0,
      payments: 0,
    };
  }, [equipment, serviceTickets, visibleGanttRentals]);

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

  useEffect(() => {
    if (!desktopCollapsed) return;
    setIsSearchOpen(false);
  }, [desktopCollapsed]);

  const groupedResults = useMemo(() => {
    return buildGlobalSearchGroups({
      equipment,
      clients,
      rentals: visibleRentals,
      ganttRentals: visibleGanttRentals,
      documents,
      serviceTickets,
      payments,
      deliveries,
      debtCollectionPlans: debtPlanResponse?.plans ?? [],
    }, {
      query: normalizedSearch,
      permissions: {
        clients: canView('clients'),
        equipment: canView('equipment'),
        rentals: canView('rentals'),
        documents: canView('documents'),
        service: canView('service'),
        payments: canView('payments'),
        finance: can('view', 'finance'),
        deliveries: canView('deliveries'),
      },
    }) as SearchGroup[];
  }, [
    can,
    canView,
    clients,
    debtPlanResponse?.plans,
    deliveries,
    documents,
    equipment,
    normalizedSearch,
    payments,
    serviceTickets,
    visibleGanttRentals,
    visibleRentals,
  ]);

  const searchResultsCount = useMemo(
    () => groupedResults.reduce((total, group) => total + group.total, 0),
    [groupedResults],
  );

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
        canView(item.section)
        && (
          isAdminReferenceMode
            ? group.items.includes(item.section) && ADMIN_REFERENCE_SECTIONS.has(item.section)
            : sidebarGroups[item.section] === group.id
        )
      )
      .sort((a, b) => {
        if (isAdminReferenceMode) {
          return group.items.indexOf(a.section) - group.items.indexOf(b.section);
        }
        return (orderIndex.get(a.section) ?? 999) - (orderIndex.get(b.section) ?? 999);
      }),
  })).filter(group => group.items.length > 0);

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen w-64',
        isAdminReferenceMode
          ? 'border-r border-[#e6ebf2] bg-white text-[#172033] shadow-none backdrop-blur-xl dark:bg-white dark:text-[#172033]'
          : 'border-r border-sidebar-border bg-[linear-gradient(180deg,#081225_0%,#0b1730_54%,#101b3f_100%)] text-sidebar-foreground shadow-[0_36px_60px_-34px_rgba(0,0,0,0.7)] backdrop-blur-xl dark:bg-none dark:bg-sidebar',
        'transition-[transform,width] duration-300 ease-in-out',
        desktopCollapsed ? 'sm:w-20' : 'sm:w-64',
        isOpen ? 'translate-x-0' : '-translate-x-full',
        'sm:translate-x-0',
      )}
    >
      <div className="flex h-full flex-col">
        <div className={cn(
          'flex items-center gap-3 border-b px-4 py-4',
          isAdminReferenceMode ? 'border-[#e6ebf2]' : 'border-sidebar-border',
          desktopCollapsed && 'sm:justify-center sm:px-3',
        )}>
          <LiftLogo className="h-9 w-9" />
          <div className={cn('min-w-0', desktopCollapsed && 'sm:hidden')}>
            <div className={cn(
              'app-shell-title truncate text-[15px] font-extrabold',
              isAdminReferenceMode ? 'text-[#172033]' : 'text-sidebar-foreground',
            )}>{isAdminReferenceMode ? APP_BRAND_NAME.toUpperCase() : APP_BRAND_NAME}</div>
          </div>
          <div className={cn('ml-auto flex items-center gap-1', desktopCollapsed && 'sm:ml-0 sm:flex-col')}>
            <button
              type="button"
              onClick={onToggleDesktopCollapse}
              className={cn(
                'hidden rounded-lg p-2 transition-colors sm:inline-flex',
                isAdminReferenceMode
                  ? 'text-[#7a869a] hover:bg-blue-50 hover:text-blue-600'
                  : 'text-white/68 hover:bg-sidebar-accent hover:text-sidebar-foreground',
              )}
              aria-label={desktopCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
              title={desktopCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
            >
              {desktopCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
            <button
              onClick={onClose}
              className={cn(
                'rounded-lg p-2 transition-colors sm:hidden',
                isAdminReferenceMode
                  ? 'text-[#7a869a] hover:bg-blue-50 hover:text-blue-600'
                  : 'text-white/68 hover:bg-sidebar-accent hover:text-sidebar-foreground',
              )}
              aria-label="Закрыть меню"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {!isAdminReferenceMode && (
        <div className={cn('px-3 py-3', desktopCollapsed && 'sm:px-2')} ref={searchRef}>
          {desktopCollapsed ? (
            <button
              type="button"
              onClick={onToggleDesktopCollapse}
              className="hidden h-10 w-full items-center justify-center rounded-xl border border-sidebar-border bg-white/8 text-white/60 transition hover:border-blue-300/40 hover:bg-white/12 hover:text-sidebar-foreground sm:flex"
              aria-label="Поиск"
              title="Поиск"
            >
              <Search className="h-4 w-4" />
            </button>
          ) : null}
          <div className={cn('relative', desktopCollapsed && 'sm:hidden')}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/55" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onFocus={() => {
                if (normalizedSearch.length > 0) setIsSearchOpen(true);
              }}
              placeholder="Поиск: техника, клиенты, аренды, сервис"
              className="h-10 rounded-xl border-sidebar-border bg-white/8 pl-9 pr-3 text-sm text-sidebar-foreground placeholder:text-white/45 focus-visible:border-blue-300/60 focus-visible:ring-blue-400/25"
            />
          </div>

          {isSearchOpen && !desktopCollapsed && (
            <div className="mt-2 rounded-2xl border border-sidebar-border bg-[#0f1b34] shadow-[0_24px_45px_-30px_rgba(0,0,0,0.85)] dark:bg-popover">
              {searchResultsCount === 0 ? (
                <div className="px-4 py-4 text-sm text-muted-foreground">
                  Ничего не найдено
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto py-2">
                  {groupedResults.map(({ group, items, hiddenCount }) => (
                    <div key={group}>
                      <div className="flex items-center justify-between px-4 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
                        <span>{group}</span>
                        {hiddenCount > 0 ? <span>ещё {hiddenCount}</span> : null}
                      </div>
                      <div className="space-y-1 px-2 pb-2">
                        {items.map((result) => {
                          const Icon = SEARCH_ICONS[result.icon];
                          return (
                            <button
                              key={result.id}
                              type="button"
                              onClick={() => handleSearchNavigate(result.href)}
                              className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/8"
                            >
                              <div className="mt-0.5 rounded-lg bg-white/8 p-2 text-white/60">
                                <Icon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-sidebar-foreground">
                                  {highlightMatch(result.title, normalizedSearch)}
                                </div>
                                <div className="line-clamp-2 text-xs text-white/55">
                                  {highlightMatch(result.subtitle, normalizedSearch)}
                                </div>
                              </div>
                              <span className="mt-1 shrink-0 text-[11px] font-medium text-blue-300">Открыть</span>
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
        )}

        <nav className={cn('flex-1 overflow-y-auto px-2 pb-2', desktopCollapsed && 'sm:px-2')}>
          {groupedNav.map(group => (
            <div key={group.title} className="mb-2">
              <div className={cn(
                'px-3 pb-1 pt-3 text-[10px] uppercase tracking-[0.18em]',
                isAdminReferenceMode ? 'font-bold text-[#9aa6b2]' : 'text-white/45',
                desktopCollapsed && 'sm:hidden',
              )}>
                {group.title}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    location.pathname === item.href ||
                    (item.href !== '/' && location.pathname.startsWith(item.href + '/'));
                  const badgeValue = navBadges[item.section as keyof typeof navBadges];
                  const displayName = isAdminReferenceMode && item.section === 'service_vehicles'
                    ? 'Служебные машины'
                    : item.name;

                  return (
                    <button
                      key={item.name}
                      type="button"
                      title={desktopCollapsed ? displayName : undefined}
                      onClick={() => {
                        navigate(item.href);
                        handleNavClick();
                      }}
                      className={cn(
                        'relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] transition-colors',
                        desktopCollapsed && 'sm:h-11 sm:justify-center sm:gap-0 sm:px-0',
                        isAdminReferenceMode
                          ? isActive
                            ? 'bg-blue-50 text-blue-700 shadow-none'
                            : 'text-[#3f4a5a] hover:bg-[#f5f8fc] hover:text-[#172033]'
                          : isActive
                            ? 'bg-[linear-gradient(135deg,#2563eb_0%,#6366f1_100%)] text-white shadow-[0_16px_30px_-22px_rgba(59,130,246,0.95)] dark:bg-none dark:bg-primary dark:text-primary-foreground dark:shadow-[0_16px_30px_-22px_rgba(212,247,74,0.95)]'
                            : 'text-white/68 hover:bg-white/8 hover:text-sidebar-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className={cn('flex-1', desktopCollapsed && 'sm:hidden')}>{displayName}</span>
                      {typeof badgeValue === 'number' && badgeValue > 0 ? (
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-medium',
                          desktopCollapsed && 'sm:absolute sm:right-1 sm:top-1 sm:min-w-4 sm:px-1 sm:text-[9px]',
                          isAdminReferenceMode
                            ? isActive
                              ? 'bg-white text-blue-700'
                              : 'bg-slate-100 text-slate-500'
                            : isActive
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

        {!isAdminReferenceMode && (
        <div className={cn('border-t border-sidebar-border px-3 pb-3 pt-2', desktopCollapsed && 'sm:px-2')}>
          <div className={cn(
            'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
            desktopCollapsed && 'sm:justify-center sm:px-0',
            theme === 'dark'
              ? 'border-sidebar-border bg-sidebar-accent text-sidebar-foreground'
              : 'border-sidebar-border bg-white/8 text-white/70',
          )}>
            {theme === 'dark' ? (
              <Moon className={cn('h-4 w-4 text-sidebar-foreground', desktopCollapsed && 'sm:hidden')} />
            ) : (
              <Sun className={cn('h-4 w-4 text-white/70', desktopCollapsed && 'sm:hidden')} />
            )}
            <span className={cn(desktopCollapsed && 'sm:hidden')}>{theme === 'dark' ? 'Тёмный режим' : 'Светлый режим'}</span>
            <button
              type="button"
              onClick={toggleTheme}
              aria-pressed={theme === 'dark'}
              aria-label="Переключить тему"
              title={theme === 'dark' ? 'Тёмный режим' : 'Светлый режим'}
              className={cn(
                'ml-auto inline-flex h-6 w-12 items-center rounded-full border p-1 transition-all',
                desktopCollapsed && 'sm:ml-0 sm:h-8 sm:w-8 sm:justify-center sm:p-0',
                theme === 'dark'
                  ? 'justify-end border-primary/30 bg-primary/90 text-primary-foreground shadow-[0_10px_24px_-18px_rgba(212,247,74,0.95)]'
                  : 'justify-start border-sidebar-border bg-white/10 text-white/70 hover:border-blue-300/40',
              )}
            >
              <span className={cn(
                'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none transition-colors',
                desktopCollapsed && 'sm:h-5 sm:min-w-5 sm:px-0',
                theme === 'dark'
                  ? 'bg-black/20 text-primary-foreground'
                  : 'bg-white/85 text-slate-700',
              )}>
                <span className={cn(desktopCollapsed && 'sm:hidden')}>{theme === 'dark' ? 'On' : 'Off'}</span>
                {theme === 'dark' ? (
                  <Moon className={cn('hidden h-3.5 w-3.5', desktopCollapsed && 'sm:block')} />
                ) : (
                  <Sun className={cn('hidden h-3.5 w-3.5', desktopCollapsed && 'sm:block')} />
                )}
              </span>
            </button>
          </div>
        </div>
        )}
      </div>
    </aside>
  );
}
