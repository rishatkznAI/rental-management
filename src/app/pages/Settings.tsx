import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Plus, Trash2, Edit, Eye, EyeOff, AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert, Download, Upload, ArrowUp, ArrowDown, LayoutPanelLeft } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet';
import { Input } from '../components/ui/input';
import {
  type Owner,
} from '../mock-data';
// Пользовательское хранилище вынесено в отдельный модуль
import {
  type UserRole, type UserStatus, type SystemUser,
  ROLES,
  isMechanicRole,
  isWarrantyMechanicRole,
  normalizeUserRole,
} from '../lib/userStorage';
import { usersService } from '../services/users.service';
import { ownersService } from '../services/owners.service';
import { mechanicsService } from '../services/mechanics.service';
import { deliveryCarriersService, type DeliveryCarrierConnection } from '../services/delivery-carriers.service';
import { serviceWorksService } from '../services/service-works.service';
import { sparePartsService } from '../services/spare-parts.service';
import { serviceRouteNormsService } from '../services/service-route-norms.service';
import { appSettingsService } from '../services/app-settings.service';
import { equipmentService } from '../services/equipment.service';
import { reportsService } from '../services/reports.service';
import { rentalsService } from '../services/rentals.service';
import { serviceTicketsService } from '../services/service-tickets.service';
import { clientsService } from '../services/clients.service';
import { paymentsService } from '../services/payments.service';
import { documentsService } from '../services/documents.service';
import { deliveriesService } from '../services/deliveries.service';
import { EQUIPMENT_KEYS } from '../hooks/useEquipment';
import { RENTAL_KEYS } from '../hooks/useRentals';
import { PAYMENT_KEYS } from '../hooks/usePayments';
import { SERVICE_TICKET_KEYS } from '../hooks/useServiceTickets';
import { usePermissions } from '../lib/permissions';
import { useAuth } from '../contexts/AuthContext';
import { api, API_BASE_URL, getToken } from '../lib/api';
import { frontendBuildInfo } from '../lib/build-info';
import { buildRentalCreationHistory, createRentalHistoryEntry } from '../lib/rental-history';
import { appendAuditHistory, createAuditEntry } from '../lib/entity-history';
import {
  DEFAULT_SIDEBAR_ORDER,
  SIDEBAR_NAV_GROUP_SETTING_KEY,
  SIDEBAR_NAV_GROUPS,
  SIDEBAR_SECTION_LABELS,
  normalizeSidebarGroups,
  normalizeSidebarOrder,
  type SidebarNavGroupId,
} from '../lib/navigation';
import {
  ADMIN_FORMS_SETTING_KEY,
  ADMIN_LISTS_SETTING_KEY,
  DEFAULT_ADMIN_FORMS,
  DEFAULT_ADMIN_LISTS,
  resolveAdminForms,
  resolveAdminLists,
  type AdminFieldType,
  type AdminFormConfig,
  type AdminListConfig,
} from '../lib/adminConfig';
import {
  EQUIPMENT_TYPE_CATALOG_SETTING_KEY,
  makeCustomEquipmentTypeValue,
  resolveEquipmentTypeCatalog,
  type EquipmentTypeCatalogItem,
} from '../lib/equipmentTypes';
import {
  buildSparePartsImportPlan,
  sparePartsToCsv,
} from '../lib/sparePartsImportExport.js';
import type {
  AppSetting,
  Equipment,
  EquipmentCategory,
  EquipmentStatus,
  EquipmentType,
  EquipmentDrive,
  EquipmentOwnerType,
  Client,
  ClientStatus,
  ServiceTicket,
  ServiceStatus,
  Mechanic,
  DeliveryCarrier,
  ReferenceStatus,
  ServiceWork,
  ServiceRouteNorm,
  SparePart,
  Rental,
} from '../types';
import type { GanttRentalData } from '../mock-data';

// ── Вспомогательные ───────────────────────────────────────────────────────────

type BadgeVariant = 'danger' | 'warning' | 'info' | 'success' | 'secondary';

function roleBadgeVariant(role: UserRole): BadgeVariant {
  if (role === 'Администратор') return 'danger';
  if (role === 'Менеджер по продажам') return 'success';
  if (isWarrantyMechanicRole(role)) return 'warning';
  if (isMechanicRole(role)) return 'warning';
  if (role === 'Перевозчик') return 'secondary';
  return 'info';
}

const EMPTY_FORM = {
  name: '',
  email: '',
  role: 'Менеджер по аренде' as UserRole,
  status: 'Активен' as UserStatus,
  password: '',
  ownerId: '',
  ownerName: '',
};

// ── Основной компонент ────────────────────────────────────────────────────────

export default function Settings() {
  const { can } = usePermissions();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = React.useState('users');
  const [users, setUsersState] = React.useState<SystemUser[]>([]);
  const { data: usersData = [] } = useQuery<SystemUser[]>({
    queryKey: ['users'],
    queryFn: usersService.getAll,
  });
  const { data: ownersData = [] } = useQuery<Owner[]>({
    queryKey: ['owners'],
    queryFn: ownersService.getAll,
  });
  const { data: appSettings = [] } = useQuery<AppSetting[]>({
    queryKey: ['app-settings'],
    queryFn: appSettingsService.getAll,
  });

  React.useEffect(() => {
    setUsersState(usersData);
  }, [usersData]);

  const sidebarOrderSetting = React.useMemo(
    () => appSettings.find(item => item.key === 'sidebar_navigation_order') || null,
    [appSettings],
  );
  const sidebarGroupSetting = React.useMemo(
    () => appSettings.find(item => item.key === SIDEBAR_NAV_GROUP_SETTING_KEY) || null,
    [appSettings],
  );
  const [sidebarOrder, setSidebarOrder] = React.useState(DEFAULT_SIDEBAR_ORDER);
  const [sidebarGroups, setSidebarGroups] = React.useState(() => normalizeSidebarGroups(null));

  React.useEffect(() => {
    setSidebarOrder(normalizeSidebarOrder(sidebarOrderSetting?.value));
  }, [sidebarOrderSetting]);

  React.useEffect(() => {
    setSidebarGroups(normalizeSidebarGroups(sidebarGroupSetting?.value));
  }, [sidebarGroupSetting]);

  const moveSidebarSection = React.useCallback((section: (typeof DEFAULT_SIDEBAR_ORDER)[number], direction: -1 | 1) => {
    setSidebarOrder(current => {
      const groupId = sidebarGroups[section];
      const groupSections = current.filter(item => sidebarGroups[item] === groupId);
      const groupIndex = groupSections.indexOf(section);
      const targetSection = groupSections[groupIndex + direction];
      if (!targetSection) return current;
      const index = current.indexOf(section);
      const targetIndex = current.indexOf(targetSection);
      if (index < 0 || targetIndex < 0) return current;
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }, [sidebarGroups]);

  const moveSidebarSectionToGroup = React.useCallback((section: (typeof DEFAULT_SIDEBAR_ORDER)[number], groupId: SidebarNavGroupId) => {
    const nextGroups = { ...sidebarGroups, [section]: groupId };
    setSidebarGroups(nextGroups);
    setSidebarOrder(current => {
      const withoutSection = current.filter(item => item !== section);
      const lastTargetIndex = withoutSection.reduce((lastIndex, item, index) => (
        nextGroups[item] === groupId ? index : lastIndex
      ), -1);
      const next = [...withoutSection];
      next.splice(lastTargetIndex + 1, 0, section);
      return next;
    });
  }, [sidebarGroups]);

  const handleSaveSidebarOrder = React.useCallback(async () => {
    const now = new Date().toISOString();
    const orderPayload = {
      key: 'sidebar_navigation_order',
      value: sidebarOrder,
      createdAt: sidebarOrderSetting?.createdAt || now,
      updatedAt: now,
    };
    const groupPayload = {
      key: SIDEBAR_NAV_GROUP_SETTING_KEY,
      value: sidebarGroups,
      createdAt: sidebarGroupSetting?.createdAt || now,
      updatedAt: now,
    };

    await Promise.all([
      sidebarOrderSetting
        ? appSettingsService.update(sidebarOrderSetting.id, orderPayload)
        : appSettingsService.create(orderPayload),
      sidebarGroupSetting
        ? appSettingsService.update(sidebarGroupSetting.id, groupPayload)
        : appSettingsService.create(groupPayload),
    ]);

    await queryClient.invalidateQueries({ queryKey: ['app-settings'] });
  }, [queryClient, sidebarGroupSetting, sidebarGroups, sidebarOrder, sidebarOrderSetting]);

  // ── Диалог ──────────────────────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [showPassword, setShowPassword] = React.useState(false);
  const [formError, setFormError] = React.useState('');
  const [userAction, setUserAction] = React.useState<{ type: 'deactivate' | 'activate' | 'delete'; user: SystemUser } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = React.useState('');
  const [userActionError, setUserActionError] = React.useState('');

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowPassword(false);
    setFormError('');
    setDialogOpen(true);
  };

  const openEdit = (user: SystemUser) => {
    setEditingId(user.id);
    setForm({
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      password: '',
      ownerId: user.ownerId || '',
      ownerName: user.ownerName || '',
    });
    setShowPassword(false);
    setFormError('');
    setDialogOpen(true);
  };

  const refreshUsers = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['users'] });
  }, [queryClient]);

  const openUserAction = (type: 'deactivate' | 'activate' | 'delete', user: SystemUser) => {
    setUserAction({ type, user });
    setDeleteConfirmation('');
    setUserActionError('');
  };

  const closeUserAction = () => {
    setUserAction(null);
    setDeleteConfirmation('');
    setUserActionError('');
  };

  const handleConfirmUserAction = async () => {
    if (!userAction) return;
    setUserActionError('');
    try {
      if (userAction.type === 'deactivate') {
        await usersService.update(userAction.user.id, { status: 'Неактивен', confirm: true } as Partial<SystemUser> & { confirm: boolean });
      } else if (userAction.type === 'activate') {
        await usersService.update(userAction.user.id, { status: 'Активен' });
      } else {
        await usersService.delete(userAction.user.id, deleteConfirmation);
      }
      await refreshUsers();
      closeUserAction();
    } catch (error) {
      setUserActionError(error instanceof Error ? error.message : 'Не удалось выполнить действие');
    }
  };

  const handleSave = async () => {
    if (!form.name.trim())  { setFormError('Введите имя'); return; }
    if (!form.email.trim()) { setFormError('Введите технический email'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { setFormError('Некорректный технический email'); return; }
    if (form.role === 'Инвестор' && !form.ownerId) { setFormError('Для роли инвестора выберите собственника'); return; }

    // Проверка дублирующего email (при добавлении или смене email)
    const duplicate = users.find(u => u.email.toLowerCase() === form.email.toLowerCase() && u.id !== editingId);
    if (duplicate) { setFormError('Пользователь с таким email уже существует'); return; }

    const selectedOwner = ownersData.find(owner => owner.id === form.ownerId);
    const ownerPayload = form.role === 'Инвестор'
      ? {
          ownerId: form.ownerId,
          ownerName: selectedOwner?.name || form.ownerName || '',
        }
      : {
          ownerId: undefined,
          ownerName: undefined,
        };

    if (editingId) {
      // При редактировании: пустой пароль = не меняем; непустой сервер сохранит как scrypt-хеш.
      const nextPassword = form.password ? form.password : undefined;
      const normalizedRole = normalizeUserRole(form.role) as UserRole;
      const previousUser = users.find(user => user.id === editingId);
      if (previousUser?.status === 'Активен' && form.status !== 'Активен') {
        setFormError('Для деактивации используйте действие «Деактивировать» в таблице пользователей.');
        return;
      }
      await usersService.update(editingId, {
        name: form.name,
        email: form.email,
        role: normalizedRole,
        status: form.status,
        ...(normalizedRole === 'Перевозчик'
          ? { botOnly: true, allowFrontendLogin: false, frontendAccess: false }
          : {}),
        ...ownerPayload,
        ...(nextPassword ? { password: nextPassword } : {}),
      });
      await refreshUsers();
    } else {
      if (!form.password.trim()) { setFormError('Задайте пароль для нового пользователя'); return; }
      const normalizedRole = normalizeUserRole(form.role) as UserRole;
      const newUser: SystemUser = {
        id: Date.now().toString(),
        name: form.name,
        email: form.email,
        role: normalizedRole,
        status: form.status,
        password: form.password,
        ...(normalizedRole === 'Перевозчик'
          ? { botOnly: true, allowFrontendLogin: false, frontendAccess: false }
          : {}),
        ...ownerPayload,
      };
      await usersService.create(newUser);
      await refreshUsers();
    }
    setDialogOpen(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl text-gray-900 dark:text-white">Панель администратора</h1>
        <p className="mt-1 text-sm text-gray-500">Управление пользователями, справочниками, системными данными и порядком левого меню</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="flex h-auto w-full justify-start gap-4 overflow-x-auto rounded-none border-b border-gray-200 bg-transparent p-0 dark:border-gray-700">
          {[
            { value: 'users',         label: 'Пользователи и роли' },
            { value: 'menu',          label: 'Левое меню' },
            { value: 'configuration', label: 'Списки и поля' },
            { value: 'reference',     label: 'Справочники' },
            { value: 'notifications', label: 'Уведомления' },
            { value: 'data',          label: 'Данные системы' },
            { value: 'audit',         label: 'Журнал действий' },
            { value: 'diagnostics',   label: 'Диагностика' },
          ].map(tab => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="shrink-0 whitespace-nowrap border-b-2 border-transparent px-4 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 data-[state=active]:border-[--color-primary] data-[state=active]:text-[--color-primary]"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Пользователи ─────────────────────────────────────────────────── */}
        <TabsContent value="users">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Пользователи системы</CardTitle>
                  <CardDescription>Управление доступом сотрудников. Вход — по логину и паролю; логин берётся из части email до @.</CardDescription>
                </div>
                <Button onClick={openAdd}>
                  <Plus className="h-4 w-4" />
                  Добавить пользователя
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {users.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">
                  Нет пользователей. Нажмите «Добавить пользователя».
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Имя</TableHead>
                      <TableHead>Технический email</TableHead>
                      <TableHead>Роль</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Собственник</TableHead>
                      <TableHead className="w-[220px]">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map(user => (
                      <TableRow key={user.id}>
                        <TableCell><p className="font-medium">{user.name}</p></TableCell>
                        <TableCell><p className="text-sm">{user.email}</p></TableCell>
                        <TableCell>
                          <Badge variant={roleBadgeVariant(user.role)}>{user.role}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.status === 'Активен' ? 'success' : 'secondary'}>
                            {user.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm">{user.role === 'Инвестор' ? (user.ownerName || 'Не привязан') : '—'}</p>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => openEdit(user)}
                              className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                              title="Редактировать"
                            >
                              <Edit className="h-4 w-4 text-gray-500" />
                            </button>
                            {user.status === 'Активен' ? (
                              <Button
                                variant="secondary"
                                className="h-8 px-2 text-xs"
                                onClick={() => openUserAction('deactivate', user)}
                              >
                                Деактивировать
                              </Button>
                            ) : (
                              <Button
                                variant="secondary"
                                className="h-8 px-2 text-xs"
                                onClick={() => openUserAction('activate', user)}
                              >
                                Активировать
                              </Button>
                            )}
                            <button
                              onClick={() => openUserAction('delete', user)}
                              className="rounded p-1 hover:bg-red-50 dark:hover:bg-red-900/20"
                              title="Удалить"
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {/* Подсказка о дефолтных паролях */}
              <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                ⚠ Пароль по умолчанию для первых трёх сотрудников: <strong>1234</strong> — смените через кнопку редактирования.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="menu">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LayoutPanelLeft className="h-5 w-5" />
                  Порядок левого меню
                </CardTitle>
                <CardDescription>
                  Администратор может менять порядок пунктов боковой навигации. Изменения применяются для всех пользователей системы.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-2">
                  {SIDEBAR_NAV_GROUPS.map(group => {
                    const items = sidebarOrder.filter(section =>
                      sidebarGroups[section] === group.id,
                    );
                    if (!items.length) return null;
                    return (
                      <div key={group.title} className="rounded-2xl border border-gray-200 p-4 dark:border-gray-700">
                        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{group.title}</div>
                        <div className="space-y-2">
                          {items.map((section, index) => {
                            return (
                              <div key={section} className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 dark:border-gray-700 dark:bg-gray-900 xl:flex-row xl:items-center">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                                  {index + 1}
                                </div>
                                <div className="flex-1">
                                  <div className="font-medium text-gray-900 dark:text-white">{SIDEBAR_SECTION_LABELS[section]}</div>
                                  <div className="text-xs text-gray-500">{section}</div>
                                </div>
                                <select
                                  value={sidebarGroups[section]}
                                  onChange={event => moveSidebarSectionToGroup(section, event.target.value as SidebarNavGroupId)}
                                  className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-white xl:w-44"
                                  title="Блок меню"
                                >
                                  {SIDEBAR_NAV_GROUPS.map(option => (
                                    <option key={option.id} value={option.id}>{option.title}</option>
                                  ))}
                                </select>
                                <div className="flex gap-2 self-end xl:self-auto">
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="outline"
                                    onClick={() => moveSidebarSection(section, -1)}
                                    disabled={index <= 0}
                                  >
                                    <ArrowUp className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="outline"
                                    onClick={() => moveSidebarSection(section, 1)}
                                    disabled={index === items.length - 1}
                                  >
                                    <ArrowDown className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-end">
                  <Button onClick={() => void handleSaveSidebarOrder()}>
                    Сохранить порядок меню
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="configuration">
          <AdminConfigurationSection appSettings={appSettings} />
        </TabsContent>

        {/* ── Справочники ──────────────────────────────────────────────────── */}
        <TabsContent value="reference">
          <div className="grid gap-6 lg:grid-cols-2">
            <EquipmentTypesReferenceList appSettings={appSettings} />
            <ReferenceList title="Локации"         items={['Москва, склад А', 'Москва, склад Б', 'Санкт-Петербург']} />
            <StatusList />
            <ReferenceList title="Причины простоя" items={['Плановое ТО', 'Ремонт', 'Ожидание запчастей', 'Калибровка']} />
            <OwnersReferenceList />
            <MechanicsReferenceList />
            <ServiceRouteNormsReferenceList />
            <DeliveryCarriersReferenceList />
            <ServiceWorkCatalogReferenceList />
            <SparePartsReferenceList />
          </div>
        </TabsContent>

        {/* ── Уведомления ──────────────────────────────────────────────────── */}
        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Правила уведомлений</CardTitle>
              <CardDescription>Настройка email и Telegram уведомлений</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                {[
                  { title: 'Возврат завтра',             desc: 'Напоминание о технике, которая должна вернуться на следующий день', channels: ['Центр уведомлений'] },
                  { title: 'Просроченные возвраты',      desc: 'Сигнал о возвратах, которые уже просрочены', channels: ['Центр уведомлений', 'MAX'] },
                  { title: 'Ожидает приёмки',            desc: 'Техника должна вернуться сегодня, но приёмка ещё не оформлена', channels: ['Центр уведомлений'] },
                  { title: 'Заявка без механика',        desc: 'Открытая сервисная заявка без назначенного исполнителя', channels: ['Центр уведомлений'] },
                  { title: 'Просроченное ТО',            desc: 'Напоминание по плановому ТО, ЧТО и ПТО', channels: ['Центр уведомлений'] },
                  { title: 'Просроченные платежи',       desc: 'Уведомление о неоплаченных и частично оплаченных платежах', channels: ['Центр уведомлений'] },
                  { title: 'Новая аренда при долге',     desc: 'Сигнал, если аренда создаётся клиенту с действующим долгом или открытой просрочкой', channels: ['Центр уведомлений'] },
                ].map(rule => (
                  <div key={rule.title} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <div>
                      <p className="font-medium">{rule.title}</p>
                      <p className="text-sm text-gray-500">{rule.desc}</p>
                    </div>
                    <div className="flex gap-2">
                      {rule.channels.map(ch => <Badge key={ch}>{ch}</Badge>)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t pt-6">
                <h3 className="mb-4 font-medium">Настройки Telegram</h3>
                <div className="space-y-3">
                  <Input label="Bot Token" placeholder="Введите токен бота" type="password" />
                  <Input label="Chat ID"   placeholder="Введите ID чата" />
                  <Button variant="secondary">Проверить соединение</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Данные системы ────────────────────────────────────────────────── */}
        <TabsContent value="data">
          <div className="space-y-6">
            <SystemDataBackupSection canManageData={can('edit', 'admin_panel')} />
            <DataManagementSection canManageData={can('edit', 'admin_panel')} />
            <DataResetSection />
          </div>
        </TabsContent>

        <TabsContent value="audit">
          <AuditLogSection />
        </TabsContent>

        <TabsContent value="diagnostics">
          <ProductionDiagnosticsSection />
        </TabsContent>
      </Tabs>

      {/* ── Диалог добавления / редактирования ─────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Редактировать пользователя' : 'Новый пользователь'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Имя */}
            <Field label="Полное имя">
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Иванов Иван Иванович"
                className={fieldClass}
              />
            </Field>

            {/* Email */}
            <Field label="Технический email">
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="ivanov@company.ru"
                className={fieldClass}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Логин для входа — часть до @.</p>
            </Field>

            {/* Пароль */}
            <Field label={editingId ? 'Новый пароль (оставьте пустым чтобы не менять)' : 'Пароль'}>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder={editingId ? '••••••••' : 'Минимум 4 символа'}
                  className={`${fieldClass} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            {/* Роль */}
            <Field label="Роль">
              <Select value={form.role} onValueChange={val => setForm(f => ({ ...f, role: val as UserRole }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>

            {form.role === 'Инвестор' && (
              <Field label="Собственник инвестора">
                <Select
                  value={form.ownerId}
                  onValueChange={val => {
                    const selectedOwner = ownersData.find(owner => owner.id === val);
                    setForm(f => ({ ...f, ownerId: val, ownerName: selectedOwner?.name || '' }));
                  }}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder="Выберите собственника" /></SelectTrigger>
                  <SelectContent>
                    {ownersData.map(owner => <SelectItem key={owner.id} value={owner.id}>{owner.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {form.role === 'Перевозчик' && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                Пользователь-перевозчик работает только через MAX-бот. Вход во frontend для этой роли будет закрыт автоматически.
              </div>
            )}

            {/* Статус */}
            <Field label="Статус">
              <Select value={form.status} onValueChange={val => setForm(f => ({ ...f, status: val as UserStatus }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Активен">Активен</SelectItem>
                  <SelectItem value="Неактивен">Неактивен (вход запрещён)</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {formError && <p className="text-sm text-red-600">{formError}</p>}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Отмена</Button>
            </DialogClose>
            <Button onClick={handleSave}>
              {editingId ? 'Сохранить' : 'Добавить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(userAction)} onOpenChange={(open) => { if (!open) closeUserAction(); }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {userAction?.type === 'delete'
                ? 'Удалить пользователя?'
                : userAction?.type === 'activate'
                  ? 'Активировать пользователя?'
                  : 'Деактивировать пользователя?'}
            </DialogTitle>
          </DialogHeader>

          {userAction && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-900">
                <p className="font-medium text-gray-900 dark:text-white">{userAction.user.name}</p>
                <p className="text-gray-600 dark:text-gray-300">{userAction.user.email}</p>
                <p className="text-gray-500 dark:text-gray-400">Роль: {userAction.user.role}</p>
              </div>

              {userAction.type === 'delete' ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                    Это опасное действие. Лучше деактивировать пользователя, чтобы сохранить историю.
                  </div>
                  <Field label="Введите технический email пользователя для подтверждения">
                    <Input
                      value={deleteConfirmation}
                      onChange={event => setDeleteConfirmation(event.target.value)}
                      placeholder={userAction.user.email}
                    />
                  </Field>
                </div>
              ) : userAction.type === 'activate' ? (
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Пользователь снова сможет входить в систему после активации.
                </p>
              ) : (
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Пользователь не сможет входить в систему, но история действий сохранится.
                </p>
              )}

              {currentUser?.id === userAction.user.id && userAction.type !== 'activate' && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                  Нельзя удалить или деактивировать самого себя.
                </div>
              )}

              {userActionError && <p className="text-sm text-red-600">{userActionError}</p>}
            </div>
          )}

          <DialogFooter>
            <Button variant="secondary" onClick={closeUserAction}>Отмена</Button>
            {userAction?.type === 'delete' ? (
              <Button
                variant="destructive"
                onClick={handleConfirmUserAction}
                disabled={!userAction || deleteConfirmation !== userAction.user.email || currentUser?.id === userAction.user.id}
              >
                Удалить
              </Button>
            ) : userAction?.type === 'activate' ? (
              <Button onClick={handleConfirmUserAction}>Активировать</Button>
            ) : (
              <Button
                variant="destructive"
                onClick={handleConfirmUserAction}
                disabled={!userAction || currentUser?.id === userAction.user.id}
              >
                Деактивировать
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Мелкие подкомпоненты ──────────────────────────────────────────────────────

const fieldClass =
  'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[--color-primary]';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      {children}
    </div>
  );
}

type ProductionDiagnostics = {
  ok: boolean;
  generatedAt: string;
  health: { ok: boolean; uptime: number };
  backend: {
    build?: {
      service?: string;
      commit?: string;
      commitFull?: string;
      buildTime?: string;
      startedAt?: string;
      deployment?: Record<string, string>;
      version?: string;
    } | null;
  };
  user: {
    id: string;
    name: string;
    email: string;
    rawRole: string;
    normalizedRole: string;
  };
  access: {
    readableCollections: string[];
    writableCollections: string[];
  };
  endpoints: Record<string, {
    ok: boolean;
    collection: string;
    count?: number;
    error?: string;
  }>;
};

type ClientEndpointStatus = {
  name: string;
  path: string;
  ok: boolean;
  status?: number;
  count?: number;
  error?: string;
};

type DemoStatusResponse = {
  ok: boolean;
  demo: {
    enabled: boolean;
    resetAllowed: boolean;
    label: string;
    message: string;
  };
};

type AuditLogEntry = {
  id: string;
  createdAt: string;
  userId?: string | null;
  userName?: string | null;
  role?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  description?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

type AuditLogResponse = {
  ok: boolean;
  logs: AuditLogEntry[];
  filters: {
    actions: string[];
    sections: string[];
  };
};

type BackupHistoryEntry = {
  id: string;
  createdAt: string;
  userName?: string | null;
  userEmail?: string | null;
  role?: string | null;
  filename: string;
  size: number;
  collectionsCount: number;
  filesCount: number;
};

type BackupHistoryResponse = {
  ok: boolean;
  history: BackupHistoryEntry[];
};

type ExternalPhotoArchiveSummary = {
  found: number;
  archived: number;
  skipped: number;
  failed: number;
  alreadyArchived: number;
  collections: Record<string, number>;
  domains: Record<string, number>;
};

type ExternalPhotoArchiveResponse = {
  ok: boolean;
  dryRun: boolean;
  allowDomains: string[];
  summary: ExternalPhotoArchiveSummary;
};

const DIAGNOSTIC_ENDPOINTS = [
  { name: 'equipment', path: '/api/equipment' },
  { name: 'rentals', path: '/api/rentals' },
  { name: 'service', path: '/api/service' },
  { name: 'deliveries', path: '/api/deliveries' },
  { name: 'documents', path: '/api/documents' },
  { name: 'payments', path: '/api/payments' },
];

async function checkClientEndpoints(): Promise<ClientEndpointStatus[]> {
  return Promise.all(DIAGNOSTIC_ENDPOINTS.map(async endpoint => {
    try {
      const data = await api.get<unknown>(endpoint.path);
      return {
        ...endpoint,
        ok: true,
        count: Array.isArray(data) ? data.length : undefined,
      };
    } catch (error) {
      return {
        ...endpoint,
        ok: false,
        status: typeof error === 'object' && error && 'status' in error ? Number((error as { status?: number }).status) : undefined,
        error: error instanceof Error ? error.message : 'Endpoint недоступен',
      };
    }
  }));
}

function formatValue(value: unknown) {
  const text = String(value || '').trim();
  return text || '—';
}

function DiagnosticsField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-700">
      <p className="text-xs uppercase tracking-[0.16em] text-gray-500">{label}</p>
      <div className="mt-1 break-words text-sm font-medium text-gray-900 dark:text-white">{value}</div>
    </div>
  );
}

function CollectionList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <p className="text-sm font-medium text-gray-900 dark:text-white">{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">Нет данных.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {items.map(item => (
            <Badge key={item} variant="secondary">{item}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function EndpointStatusTable({
  backendEndpoints,
  clientEndpoints,
}: {
  backendEndpoints: ProductionDiagnostics['endpoints'];
  clientEndpoints: ClientEndpointStatus[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Endpoint</TableHead>
          <TableHead>Backend</TableHead>
          <TableHead>Frontend request</TableHead>
          <TableHead>Count</TableHead>
          <TableHead>Ошибка</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {DIAGNOSTIC_ENDPOINTS.map(endpoint => {
          const backend = backendEndpoints?.[endpoint.name];
          const client = clientEndpoints.find(item => item.name === endpoint.name);
          const ok = Boolean(backend?.ok && client?.ok);
          return (
            <TableRow key={endpoint.name}>
              <TableCell className="font-mono text-xs">{endpoint.path}</TableCell>
              <TableCell>
                <Badge variant={backend?.ok ? 'success' : 'danger'}>
                  {backend?.ok ? 'OK' : 'Ошибка'}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={client?.ok ? 'success' : 'danger'}>
                  {client?.ok ? 'OK' : `Ошибка${client?.status ? ` ${client.status}` : ''}`}
                </Badge>
              </TableCell>
              <TableCell>{client?.count ?? backend?.count ?? '—'}</TableCell>
              <TableCell className={ok ? 'text-gray-500' : 'text-red-600'}>
                {client?.error || backend?.error || '—'}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function AuditLogSection() {
  const [userFilter, setUserFilter] = React.useState('');
  const [actionFilter, setActionFilter] = React.useState('all');
  const [sectionFilter, setSectionFilter] = React.useState('all');
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');

  const query = useQuery<AuditLogResponse>({
    queryKey: ['admin-audit-logs', userFilter, actionFilter, sectionFilter, dateFrom, dateTo],
    queryFn: () => {
      const params = new URLSearchParams();
      if (userFilter.trim()) params.set('user', userFilter.trim());
      if (actionFilter !== 'all') params.set('action', actionFilter);
      if (sectionFilter !== 'all') params.set('section', sectionFilter);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      params.set('limit', '200');
      return api.get<AuditLogResponse>(`/api/admin/audit-logs?${params.toString()}`);
    },
    retry: 1,
  });

  const logs = query.data?.logs || [];
  const actions = query.data?.filters?.actions || [];
  const sections = query.data?.filters?.sections || [];
  const clearFilters = () => {
    setUserFilter('');
    setActionFilter('all');
    setSectionFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Журнал действий</CardTitle>
            <CardDescription>Admin-only аудит входов, изменений данных, import/export и важных операций без паролей, токенов и secrets.</CardDescription>
          </div>
          <Button variant="secondary" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-5">
          <input
            value={userFilter}
            onChange={event => setUserFilter(event.target.value)}
            placeholder="Пользователь"
            className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger><SelectValue placeholder="Действие" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все действия</SelectItem>
              {actions.map(action => <SelectItem key={action} value={action}>{action}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sectionFilter} onValueChange={setSectionFilter}>
            <SelectTrigger><SelectValue placeholder="Раздел" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все разделы</SelectItem>
              {sections.map(section => <SelectItem key={section} value={section}>{section}</SelectItem>)}
            </SelectContent>
          </Select>
          <input
            type="date"
            value={dateFrom}
            onChange={event => setDateFrom(event.target.value)}
            className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
          <input
            type="date"
            value={dateTo}
            onChange={event => setDateTo(event.target.value)}
            className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={clearFilters}>Сбросить фильтры</Button>
        </div>

        {query.isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            Журнал действий недоступен: {query.error instanceof Error ? query.error.message : 'неизвестная ошибка'}.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Пользователь</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead>Действие</TableHead>
                <TableHead>Сущность</TableHead>
                <TableHead>Описание</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-gray-500">
                    Записей не найдено.
                  </TableCell>
                </TableRow>
              ) : logs.map(entry => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-xs">{entry.createdAt ? new Date(entry.createdAt).toLocaleString('ru-RU') : '—'}</TableCell>
                  <TableCell>
                    <p className="text-sm font-medium">{entry.userName || 'Система'}</p>
                    <p className="text-xs text-gray-500">{entry.userId || '—'}</p>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{entry.role || '—'}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                  <TableCell>
                    <p className="text-sm">{entry.entityType || '—'}</p>
                    <p className="font-mono text-xs text-gray-500">{entry.entityId || '—'}</p>
                  </TableCell>
                  <TableCell className="max-w-[360px] text-sm">{entry.description || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ProductionDiagnosticsSection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [demoResetStatus, setDemoResetStatus] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const diagnosticsQuery = useQuery<ProductionDiagnostics>({
    queryKey: ['admin-production-diagnostics'],
    queryFn: () => api.get<ProductionDiagnostics>('/api/admin/production-diagnostics'),
    retry: 1,
  });
  const demoStatusQuery = useQuery<DemoStatusResponse>({
    queryKey: ['demo-status'],
    queryFn: () => api.get<DemoStatusResponse>('/api/demo/status'),
    retry: 0,
  });
  const endpointQuery = useQuery<ClientEndpointStatus[]>({
    queryKey: ['admin-production-diagnostics-endpoints'],
    queryFn: checkClientEndpoints,
    retry: 0,
  });

  const diagnostics = diagnosticsQuery.data;
  const demo = demoStatusQuery.data?.demo;
  const backendBuild = diagnostics?.backend?.build;
  const clientEndpoints = endpointQuery.data || [];
  const refresh = () => {
    void diagnosticsQuery.refetch();
    void demoStatusQuery.refetch();
    void endpointQuery.refetch();
  };
  const handleDemoReset = React.useCallback(async () => {
    if (!demo?.enabled || !demo.resetAllowed) return;
    const confirmed = window.confirm('Сбросить демо-данные к начальному состоянию? Реальные production-данные не затрагиваются.');
    if (!confirmed) return;
    setDemoResetStatus(null);
    try {
      await api.post('/api/demo/reset', {});
      setDemoResetStatus({ type: 'success', message: 'Демо-данные сброшены. Если сессия завершилась, войдите demo-пользователем заново.' });
      await Promise.allSettled([
        queryClient.invalidateQueries(),
        diagnosticsQuery.refetch(),
        demoStatusQuery.refetch(),
        endpointQuery.refetch(),
      ]);
    } catch (error) {
      setDemoResetStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Не удалось сбросить демо-данные.',
      });
    }
  }, [demo?.enabled, demo?.resetAllowed, diagnosticsQuery, demoStatusQuery, endpointQuery, queryClient]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Production diagnostics</CardTitle>
              <CardDescription>Состояние frontend, backend, текущей роли и основных API без секретов и токенов.</CardDescription>
            </div>
            <Button variant="secondary" onClick={refresh} disabled={diagnosticsQuery.isFetching || endpointQuery.isFetching}>
              <RefreshCw className={`h-4 w-4 ${(diagnosticsQuery.isFetching || endpointQuery.isFetching) ? 'animate-spin' : ''}`} />
              Обновить
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {diagnosticsQuery.isError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300" data-testid="diagnostics-backend-error">
              Диагностика backend недоступна: {diagnosticsQuery.error instanceof Error ? diagnosticsQuery.error.message : 'неизвестная ошибка'}.
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <DiagnosticsField label="Frontend service" value={frontendBuildInfo.service} />
            <DiagnosticsField label="Frontend commit" value={<span className="font-mono">{formatValue(frontendBuildInfo.commit)}</span>} />
            <DiagnosticsField label="Frontend build time" value={formatValue(frontendBuildInfo.buildTime)} />
            <DiagnosticsField label="Frontend mode" value={frontendBuildInfo.mode} />
            <DiagnosticsField label="VITE_API_URL" value={<span className="font-mono">{API_BASE_URL || '(same origin / Vite proxy)'}</span>} />
            <DiagnosticsField label="Backend health" value={
              diagnostics?.health?.ok
                ? <Badge variant="success">OK · uptime {diagnostics.health.uptime}s</Badge>
                : diagnosticsQuery.isLoading
                  ? 'Проверяем...'
                  : <Badge variant="danger">Недоступен</Badge>
            } />
            <DiagnosticsField label="Backend commit" value={<span className="font-mono">{formatValue(backendBuild?.commit)}</span>} />
            <DiagnosticsField label="Backend started" value={formatValue(backendBuild?.startedAt)} />
          </div>
        </CardContent>
      </Card>

      {demo?.enabled && (
        <Card data-testid="demo-reset-panel">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Демо-режим</CardTitle>
                <CardDescription>{demo.message}</CardDescription>
              </div>
              <Badge variant={demo.resetAllowed ? 'warning' : 'default'}>{demo.label}</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              Сброс заново создаёт только демо-базу и не меняет production database.
            </div>
            <Button
              variant="destructive"
              onClick={() => void handleDemoReset()}
              disabled={!demo.resetAllowed}
              data-testid="demo-reset-button"
            >
              <RefreshCw className="h-4 w-4" />
              Сбросить демо
            </Button>
            {demoResetStatus && (
              <div className={demoResetStatus.type === 'success' ? 'text-sm text-green-700 dark:text-green-300' : 'text-sm text-red-700 dark:text-red-300'}>
                {demoResetStatus.message}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Текущий пользователь</CardTitle>
            <CardDescription>Данные текущей сессии и нормализация роли.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <DiagnosticsField label="Имя" value={diagnostics?.user?.name || user?.name || '—'} />
            <DiagnosticsField label="Email" value={diagnostics?.user?.email || user?.email || '—'} />
            <DiagnosticsField label="rawRole" value={diagnostics?.user?.rawRole || user?.rawRole || user?.role || '—'} />
            <DiagnosticsField label="normalizedRole" value={diagnostics?.user?.normalizedRole || user?.normalizedRole || user?.role || '—'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Backend build</CardTitle>
            <CardDescription>Версия backend, если она доступна в деплое.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <DiagnosticsField label="Service" value={formatValue(backendBuild?.service)} />
            <DiagnosticsField label="Build time" value={formatValue(backendBuild?.buildTime)} />
            <DiagnosticsField label="Node env" value={formatValue(backendBuild?.deployment?.nodeEnv)} />
            <DiagnosticsField label="Railway env" value={formatValue(backendBuild?.deployment?.railwayEnvironment)} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <CollectionList title="Readable collections" items={diagnostics?.access?.readableCollections || []} />
        <CollectionList title="Writable collections" items={diagnostics?.access?.writableCollections || []} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Основные API</CardTitle>
          <CardDescription>Backend summary и фактическая проверка запросом из frontend.</CardDescription>
        </CardHeader>
        <CardContent>
          {endpointQuery.isError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              Не удалось проверить API из браузера: {endpointQuery.error instanceof Error ? endpointQuery.error.message : 'неизвестная ошибка'}.
            </div>
          ) : (
            <EndpointStatusTable
              backendEndpoints={diagnostics?.endpoints || {}}
              clientEndpoints={clientEndpoints}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function makeCustomFieldKey(label: string) {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '');
  return `custom_${normalized || Date.now()}`;
}

function replaceAt<T>(items: T[], index: number, value: T) {
  return items.map((item, itemIndex) => (itemIndex === index ? value : item));
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1) {
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(targetIndex, 0, item);
  return next;
}

function AdminConfigurationSection({ appSettings }: { appSettings: AppSetting[] }) {
  const queryClient = useQueryClient();
  const savedLists = React.useMemo(() => resolveAdminLists(appSettings), [appSettings]);
  const savedForms = React.useMemo(() => resolveAdminForms(appSettings), [appSettings]);
  const [lists, setLists] = React.useState<AdminListConfig[]>(savedLists);
  const [forms, setForms] = React.useState<AdminFormConfig[]>(savedForms);
  const [selectedListId, setSelectedListId] = React.useState(savedLists[0]?.id || '');
  const [selectedFormId, setSelectedFormId] = React.useState(savedForms[0]?.id || '');
  const [newOptionLabel, setNewOptionLabel] = React.useState('');
  const [newFieldLabel, setNewFieldLabel] = React.useState('');
  const [newFieldType, setNewFieldType] = React.useState<AdminFieldType>('text');
  const [message, setMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    setLists(savedLists);
  }, [savedLists]);

  React.useEffect(() => {
    setForms(savedForms);
  }, [savedForms]);

  React.useEffect(() => {
    if (!lists.some(list => list.id === selectedListId)) {
      setSelectedListId(lists[0]?.id || '');
    }
  }, [lists, selectedListId]);

  React.useEffect(() => {
    if (!forms.some(form => form.id === selectedFormId)) {
      setSelectedFormId(forms[0]?.id || '');
    }
  }, [forms, selectedFormId]);

  const selectedList = lists.find(list => list.id === selectedListId) || lists[0];
  const selectedForm = forms.find(form => form.id === selectedFormId) || forms[0];

  const saveSetting = React.useCallback(async (key: string, value: unknown) => {
    const now = new Date().toISOString();
    const existing = appSettings.find(item => item.key === key);
    const payload = {
      key,
      value,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    if (existing) {
      await appSettingsService.update(existing.id, payload);
    } else {
      await appSettingsService.create(payload);
    }
  }, [appSettings]);

  const saveAll = React.useCallback(async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      await Promise.all([
        saveSetting(ADMIN_LISTS_SETTING_KEY, lists),
        saveSetting(ADMIN_FORMS_SETTING_KEY, forms),
      ]);
      await queryClient.invalidateQueries({ queryKey: ['app-settings'] });
      setMessage({ type: 'success', text: 'Настройки списков и полей сохранены.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Не удалось сохранить настройки.' });
    } finally {
      setIsSaving(false);
    }
  }, [forms, lists, queryClient, saveSetting]);

  const resetDefaults = React.useCallback(async () => {
    const confirmed = window.confirm('Вернуть базовые настройки списков и полей? Текущие изменения в админке будут заменены.');
    if (!confirmed) return;
    setLists(DEFAULT_ADMIN_LISTS);
    setForms(DEFAULT_ADMIN_FORMS);
    setIsSaving(true);
    setMessage(null);
    try {
      await Promise.all([
        saveSetting(ADMIN_LISTS_SETTING_KEY, DEFAULT_ADMIN_LISTS),
        saveSetting(ADMIN_FORMS_SETTING_KEY, DEFAULT_ADMIN_FORMS),
      ]);
      await queryClient.invalidateQueries({ queryKey: ['app-settings'] });
      setMessage({ type: 'success', text: 'Базовые настройки восстановлены.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Не удалось восстановить базовые настройки.' });
    } finally {
      setIsSaving(false);
    }
  }, [queryClient, saveSetting]);

  const updateSelectedList = React.useCallback((updater: (list: AdminListConfig) => AdminListConfig) => {
    if (!selectedList) return;
    setLists(current => current.map(list => list.id === selectedList.id ? updater(list) : list));
    setMessage(null);
  }, [selectedList]);

  const updateSelectedForm = React.useCallback((updater: (form: AdminFormConfig) => AdminFormConfig) => {
    if (!selectedForm) return;
    setForms(current => current.map(form => form.id === selectedForm.id ? updater(form) : form));
    setMessage(null);
  }, [selectedForm]);

  const addOption = React.useCallback(() => {
    if (!selectedList?.allowCustomItems) return;
    const label = newOptionLabel.replace(/\s+/g, ' ').trim();
    if (!label) return;
    const duplicate = selectedList.items.some(item =>
      item.value.trim().toLowerCase() === label.toLowerCase() ||
      item.label.trim().toLowerCase() === label.toLowerCase()
    );
    if (duplicate) {
      setMessage({ type: 'error', text: 'Такое значение уже есть в выбранном списке.' });
      return;
    }
    updateSelectedList(list => ({
      ...list,
      items: [...list.items, { value: label, label, active: true, locked: false }],
    }));
    setNewOptionLabel('');
  }, [newOptionLabel, selectedList, updateSelectedList]);

  const addCustomField = React.useCallback(() => {
    if (!selectedForm) return;
    const label = newFieldLabel.replace(/\s+/g, ' ').trim();
    if (!label) return;
    const baseKey = makeCustomFieldKey(label);
    const keys = new Set(selectedForm.fields.map(field => field.key));
    let key = baseKey;
    let counter = 2;
    while (keys.has(key)) {
      key = `${baseKey}_${counter}`;
      counter += 1;
    }
    updateSelectedForm(form => ({
      ...form,
      fields: [
        ...form.fields,
        {
          key,
          label,
          type: newFieldType,
          visible: true,
          required: false,
          placeholder: '',
          custom: true,
        },
      ],
    }));
    setNewFieldLabel('');
    setNewFieldType('text');
  }, [newFieldLabel, newFieldType, selectedForm, updateSelectedForm]);

  const totalLists = lists.length;
  const totalFields = forms.reduce((sum, form) => sum + form.fields.length, 0);
  const customFields = forms.reduce((sum, form) => sum + form.fields.filter(field => field.custom).length, 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Центр настройки интерфейса</CardTitle>
              <CardDescription>Единое место для справочников, выпадающих списков, подписей, обязательности и видимости полей.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void resetDefaults()} disabled={isSaving}>
                <RefreshCw className="h-4 w-4" />
                Сбросить
              </Button>
              <Button onClick={() => void saveAll()} disabled={isSaving}>
                {isSaving ? 'Сохраняем...' : 'Сохранить настройки'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {message && (
            <div className={`rounded-lg border px-4 py-3 text-sm ${
              message.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
                : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
            }`}>
              {message.text}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-700">
              <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Списки</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{totalLists}</p>
            </div>
            <div className="rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-700">
              <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Поля форм</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{totalFields}</p>
            </div>
            <div className="rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-700">
              <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Доп. поля</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{customFields}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(280px,360px)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Списки</CardTitle>
            <CardDescription>Справочники для фильтров, селектов и форм</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <select
              value={selectedList?.id || ''}
              onChange={event => setSelectedListId(event.target.value)}
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              {lists.map(list => (
                <option key={list.id} value={list.id}>{list.section} · {list.title}</option>
              ))}
            </select>

            {selectedList && (
              <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{selectedList.title}</p>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{selectedList.description}</p>
                  </div>
                  <Badge variant={selectedList.allowCustomItems ? 'success' : 'secondary'}>
                    {selectedList.allowCustomItems ? 'Можно добавлять' : 'Системный'}
                  </Badge>
                </div>

                <div className="mt-4 space-y-2">
                  {selectedList.items.map((item, index) => (
                    <div key={`${item.value}-${index}`} className="grid gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700 md:grid-cols-[72px_minmax(0,1fr)] xl:grid-cols-[72px_minmax(180px,1fr)_minmax(140px,0.8fr)_120px_120px] xl:items-center">
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => updateSelectedList(list => ({ ...list, items: moveItem(list.items, index, -1) }))} disabled={index === 0}>
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => updateSelectedList(list => ({ ...list, items: moveItem(list.items, index, 1) }))} disabled={index === selectedList.items.length - 1}>
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="min-w-0 space-y-1">
                        <span className="text-xs font-medium uppercase tracking-[0.12em] text-gray-500 xl:hidden">Подпись</span>
                        <Input
                          value={item.label}
                          onChange={event => updateSelectedList(list => ({
                            ...list,
                            items: replaceAt(list.items, index, { ...item, label: event.target.value }),
                          }))}
                          placeholder="Подпись"
                        />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <span className="text-xs font-medium uppercase tracking-[0.12em] text-gray-500 xl:hidden">Ключ</span>
                        <Input value={item.value} disabled className="font-mono text-xs" />
                      </div>
                      <label className="flex items-center gap-2 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={item.active}
                          onChange={event => updateSelectedList(list => ({
                            ...list,
                            items: replaceAt(list.items, index, { ...item, active: event.target.checked }),
                          }))}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        Активен
                      </label>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="justify-start whitespace-nowrap"
                        disabled={item.locked}
                        onClick={() => updateSelectedList(list => ({ ...list, items: list.items.filter((_, itemIndex) => itemIndex !== index) }))}
                      >
                        <Trash2 className="h-4 w-4" />
                        Удалить
                      </Button>
                    </div>
                  ))}
                </div>

                {selectedList.allowCustomItems && (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={newOptionLabel}
                      onChange={event => setNewOptionLabel(event.target.value)}
                      onKeyDown={event => { if (event.key === 'Enter') addOption(); }}
                      placeholder="Новое значение списка"
                    />
                    <Button type="button" onClick={addOption}>
                      <Plus className="h-4 w-4" />
                      Добавить
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Поля форм</CardTitle>
            <CardDescription>Подписи, обязательность, видимость и порядок полей</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <select
              value={selectedForm?.id || ''}
              onChange={event => setSelectedFormId(event.target.value)}
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              {forms.map(form => (
                <option key={form.id} value={form.id}>{form.section} · {form.title}</option>
              ))}
            </select>

            {selectedForm && (
              <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{selectedForm.title}</p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{selectedForm.description}</p>
                </div>

                <div className="mt-4 space-y-2">
                  {selectedForm.fields.map((field, index) => (
                    <div key={`${field.key}-${index}`} className="grid gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700 lg:grid-cols-2 2xl:grid-cols-[72px_minmax(180px,1.2fr)_140px_minmax(180px,1fr)_112px_144px_120px] 2xl:items-center">
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => updateSelectedForm(form => ({ ...form, fields: moveItem(form.fields, index, -1) }))} disabled={index === 0}>
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => updateSelectedForm(form => ({ ...form, fields: moveItem(form.fields, index, 1) }))} disabled={index === selectedForm.fields.length - 1}>
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="min-w-0 space-y-1">
                        <span className="text-xs font-medium uppercase tracking-[0.12em] text-gray-500 2xl:hidden">Название поля</span>
                        <Input
                          value={field.label}
                          onChange={event => updateSelectedForm(form => ({
                            ...form,
                            fields: replaceAt(form.fields, index, { ...field, label: event.target.value }),
                          }))}
                          placeholder="Название поля"
                        />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <span className="text-xs font-medium uppercase tracking-[0.12em] text-gray-500 2xl:hidden">Тип</span>
                        <select
                          value={field.type}
                          onChange={event => updateSelectedForm(form => ({
                            ...form,
                            fields: replaceAt(form.fields, index, { ...field, type: event.target.value as AdminFieldType }),
                          }))}
                          disabled={!field.custom}
                          className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                        >
                          <option value="text">Текст</option>
                          <option value="number">Число</option>
                          <option value="date">Дата</option>
                          <option value="textarea">Текстовое поле</option>
                          <option value="select">Список</option>
                        </select>
                      </div>
                      <div className="min-w-0 space-y-1">
                        <span className="text-xs font-medium uppercase tracking-[0.12em] text-gray-500 2xl:hidden">Подсказка</span>
                        <Input
                          value={field.placeholder || ''}
                          onChange={event => updateSelectedForm(form => ({
                            ...form,
                            fields: replaceAt(form.fields, index, { ...field, placeholder: event.target.value }),
                          }))}
                          placeholder="Подсказка"
                        />
                      </div>
                      <label className="flex items-center gap-2 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={field.visible}
                          disabled={field.locked}
                          onChange={event => updateSelectedForm(form => ({
                            ...form,
                            fields: replaceAt(form.fields, index, { ...field, visible: event.target.checked }),
                          }))}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        Видно
                      </label>
                      <label className="flex items-center gap-2 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={field.required}
                          disabled={field.locked}
                          onChange={event => updateSelectedForm(form => ({
                            ...form,
                            fields: replaceAt(form.fields, index, { ...field, required: event.target.checked }),
                          }))}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        Обязательно
                      </label>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="justify-start whitespace-nowrap"
                        disabled={!field.custom}
                        onClick={() => updateSelectedForm(form => ({ ...form, fields: form.fields.filter((_, fieldIndex) => fieldIndex !== index) }))}
                      >
                        <Trash2 className="h-4 w-4" />
                        Удалить
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_auto]">
                  <Input
                    value={newFieldLabel}
                    onChange={event => setNewFieldLabel(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') addCustomField(); }}
                    placeholder="Название дополнительного поля"
                  />
                  <select
                    value={newFieldType}
                    onChange={event => setNewFieldType(event.target.value as AdminFieldType)}
                    className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                  >
                    <option value="text">Текст</option>
                    <option value="number">Число</option>
                    <option value="date">Дата</option>
                    <option value="textarea">Текстовое поле</option>
                  </select>
                  <Button type="button" onClick={addCustomField}>
                    <Plus className="h-4 w-4" />
                    Добавить поле
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ReferenceList({ title, items: initialItems }: { title: string; items: string[] }) {
  const [items, setItems] = React.useState(initialItems);
  const [adding, setAdding]     = React.useState(false);
  const [newValue, setNewValue] = React.useState('');
  const [editIdx, setEditIdx]   = React.useState<number | null>(null);
  const [editValue, setEditValue] = React.useState('');

  const handleAdd = () => {
    if (!newValue.trim()) return;
    setItems(prev => [...prev, newValue.trim()]);
    setNewValue(''); setAdding(false);
  };
  const handleEditSave = (idx: number) => {
    if (!editValue.trim()) return;
    setItems(prev => prev.map((it, i) => i === idx ? editValue.trim() : it));
    setEditIdx(null);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              {editIdx === idx ? (
                <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleEditSave(idx); if (e.key === 'Escape') setEditIdx(null); }}
                  className="flex-1 mr-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                />
              ) : (
                <span className="text-sm font-medium flex-1">{item}</span>
              )}
              <div className="flex gap-1">
                {editIdx === idx ? (
                  <>
                    <button onClick={() => handleEditSave(idx)} className="rounded px-2 py-1 text-xs bg-[--color-primary] text-white hover:opacity-90">OK</button>
                    <button onClick={() => setEditIdx(null)} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">✕</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => { setEditIdx(idx); setEditValue(item); }} className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700">
                      <Edit className="h-4 w-4 text-gray-500" />
                    </button>
                    <button onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))} className="rounded p-1 hover:bg-red-50 dark:hover:bg-red-900/20">
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {adding && (
            <div className="flex gap-2">
              <input autoFocus value={newValue} onChange={e => setNewValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
                placeholder="Введите название..."
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[--color-primary]"
              />
              <Button size="sm" onClick={handleAdd}>OK</Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>✕</Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function EquipmentTypesReferenceList({ appSettings }: { appSettings: AppSetting[] }) {
  const queryClient = useQueryClient();
  const catalog = React.useMemo(() => resolveEquipmentTypeCatalog(appSettings), [appSettings]);
  const setting = React.useMemo(
    () => appSettings.find(item => item.key === EQUIPMENT_TYPE_CATALOG_SETTING_KEY) || null,
    [appSettings],
  );
  const [adding, setAdding] = React.useState(false);
  const [newValue, setNewValue] = React.useState('');
  const [editValue, setEditValue] = React.useState('');
  const [editingValue, setEditingValue] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);

  const saveCatalog = React.useCallback(async (nextCatalog: EquipmentTypeCatalogItem[]) => {
    const now = new Date().toISOString();
    const payload = {
      key: EQUIPMENT_TYPE_CATALOG_SETTING_KEY,
      value: nextCatalog.map(item => ({
        value: item.value,
        label: item.label,
        isDefault: Boolean(item.isDefault),
      })),
      createdAt: setting?.createdAt || now,
      updatedAt: now,
    };

    setIsSaving(true);
    try {
      if (setting) {
        await appSettingsService.update(setting.id, payload);
      } else {
        await appSettingsService.create(payload);
      }
      await queryClient.invalidateQueries({ queryKey: ['app-settings'] });
    } finally {
      setIsSaving(false);
    }
  }, [queryClient, setting]);

  const hasDuplicate = React.useCallback((label: string, value: string, currentValue?: string) => {
    const normalizedLabel = label.trim().toLowerCase();
    const normalizedValue = value.trim().toLowerCase();
    return catalog.some(item =>
      item.value !== currentValue &&
      (
        item.label.trim().toLowerCase() === normalizedLabel ||
        item.value.trim().toLowerCase() === normalizedValue
      )
    );
  }, [catalog]);

  const handleAdd = async () => {
    const label = newValue.replace(/\s+/g, ' ').trim();
    const value = makeCustomEquipmentTypeValue(label);
    if (!label || !value) {
      setError('Введите название типа техники');
      return;
    }
    if (hasDuplicate(label, value)) {
      setError('Такой тип техники уже есть в справочнике');
      return;
    }
    setError('');
    await saveCatalog([...catalog, { value, label, isDefault: false }]);
    setNewValue('');
    setAdding(false);
  };

  const handleEditSave = async (item: EquipmentTypeCatalogItem) => {
    const label = editValue.replace(/\s+/g, ' ').trim();
    if (!label) {
      setError('Название типа техники не может быть пустым');
      return;
    }
    if (hasDuplicate(label, item.value, item.value)) {
      setError('Такой тип техники уже есть в справочнике');
      return;
    }
    setError('');
    await saveCatalog(catalog.map(entry => (
      entry.value === item.value ? { ...entry, label } : entry
    )));
    setEditingValue(null);
    setEditValue('');
  };

  const handleDelete = async (item: EquipmentTypeCatalogItem) => {
    if (item.isDefault) return;
    setError('');
    await saveCatalog(catalog.filter(entry => entry.value !== item.value));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Типы техники для продаж</CardTitle>
            <CardDescription>Справочник используется в карточке техники и при добавлении позиции в продажи</CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)} disabled={isSaving}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {catalog.map(item => (
            <div key={item.value} className="flex items-center justify-between rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              {editingValue === item.value ? (
                <input
                  autoFocus
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void handleEditSave(item);
                    if (e.key === 'Escape') setEditingValue(null);
                  }}
                  className="mr-2 flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800"
                />
              ) : (
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.label}</span>
                  <span className="block truncate text-xs text-gray-500">{item.value}</span>
                </div>
              )}

              <div className="flex gap-1">
                {editingValue === item.value ? (
                  <>
                    <button
                      onClick={() => void handleEditSave(item)}
                      className="rounded bg-[--color-primary] px-2 py-1 text-xs text-white hover:opacity-90"
                      disabled={isSaving}
                    >
                      OK
                    </button>
                    <button
                      onClick={() => setEditingValue(null)}
                      className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                      disabled={isSaving}
                    >
                      Отмена
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setEditingValue(item.value);
                        setEditValue(item.label);
                        setError('');
                      }}
                      className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                      disabled={isSaving}
                    >
                      <Edit className="h-4 w-4 text-gray-500" />
                    </button>
                    <button
                      onClick={() => void handleDelete(item)}
                      className="rounded p-1 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-900/20"
                      disabled={isSaving || item.isDefault}
                      title={item.isDefault ? 'Базовый тип нельзя удалить' : 'Удалить тип'}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}

          {adding && (
            <div className="flex gap-2">
              <input
                autoFocus
                value={newValue}
                onChange={e => setNewValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') void handleAdd();
                  if (e.key === 'Escape') setAdding(false);
                }}
                placeholder="Например: Вертикальный мачтовый подъёмник"
                className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800"
              />
              <Button size="sm" onClick={() => void handleAdd()} disabled={isSaving}>OK</Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={isSaving}>Отмена</Button>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusList() {
  return (
    <Card>
      <CardHeader><CardTitle>Статусы техники</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-2">
          {[
            { label: 'Свободен', color: 'green' },
            { label: 'В аренде',  color: 'blue'  },
            { label: 'Бронь',     color: 'yellow' },
            { label: 'В сервисе', color: 'red'   },
            { label: 'Списан',    color: 'gray'  },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <div className={`h-3 w-3 rounded-full bg-${s.color}-500`} />
              <span className="text-sm font-medium">{s.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob(['\ufeff', content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadJSON(content: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function filenameFromDisposition(disposition: string | null, fallback: string) {
  const match = String(disposition || '').match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

async function backupErrorFromResponse(response: Response) {
  let serverMessage = '';
  try {
    const body = await response.json();
    serverMessage = typeof body?.error === 'string' ? body.error : '';
  } catch {
    serverMessage = '';
  }
  const base = `Сервер не смог подготовить архив (HTTP ${response.status}).`;
  return `${base}${serverMessage ? ` ${serverMessage}` : ''} Попробуйте ещё раз или проверьте журналы.`;
}

function backupErrorFromException(error: unknown) {
  if (error instanceof TypeError) {
    return 'Не удалось скачать резервную копию: соединение с сервером было прервано. Сервер мог не успеть подготовить архив. Попробуйте ещё раз или проверьте журналы.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Не удалось скачать резервную копию. Попробуйте ещё раз или проверьте журналы.';
}

function parseCSVRow(line: string) {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result.map(value => value.trim());
}

function csvToRows(text: string) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(parseCSVRow);
}

const TYPE_IMPORT_MAP: Record<string, EquipmentType> = {
  scissor: 'scissor',
  articulated: 'articulated',
  telescopic: 'telescopic',
  'ножничный': 'scissor',
  'коленчатый': 'articulated',
  'телескопический': 'telescopic',
};

const DRIVE_IMPORT_MAP: Record<string, EquipmentDrive> = {
  diesel: 'diesel',
  electric: 'electric',
  'дизель': 'diesel',
  'электро': 'electric',
  'электрический': 'electric',
};

const STATUS_IMPORT_MAP: Record<string, EquipmentStatus> = {
  available: 'available',
  rented: 'rented',
  reserved: 'reserved',
  in_service: 'in_service',
  inactive: 'inactive',
  'свободен': 'available',
  'свободна': 'available',
  'в аренде': 'rented',
  'бронь': 'reserved',
  'забронирована': 'reserved',
  'в сервисе': 'in_service',
  'списан': 'inactive',
  'списана': 'inactive',
};

const OWNER_IMPORT_MAP: Record<string, EquipmentOwnerType> = {
  own: 'own',
  investor: 'investor',
  sublease: 'sublease',
  'собственная': 'own',
  'инвестор': 'investor',
  'субаренда': 'sublease',
};

const CATEGORY_IMPORT_MAP: Record<string, EquipmentCategory> = {
  own: 'own',
  sold: 'sold',
  client: 'client',
  partner: 'partner',
  'собственная': 'own',
  'проданная': 'sold',
  'клиентская': 'client',
  'партнёрская': 'partner',
};

const CLIENT_STATUS_IMPORT_MAP: Record<string, ClientStatus> = {
  active: 'active',
  inactive: 'inactive',
  blocked: 'blocked',
  'активен': 'active',
  'неактивен': 'inactive',
  'заблокирован': 'blocked',
};

const SERVICE_STATUS_IMPORT_MAP: Record<string, ServiceStatus> = {
  new: 'new',
  in_progress: 'in_progress',
  waiting_parts: 'waiting_parts',
  ready: 'ready',
  closed: 'closed',
};

type RentalImportPreviewStatus = 'ready' | 'conflict' | 'error' | 'duplicate';

interface RentalImportPreviewRow {
  line: number;
  client: string;
  equipmentLabel: string;
  startDate: string;
  endDate: string;
  status: RentalImportPreviewStatus;
  message: string;
  ganttPayload?: Omit<GanttRentalData, 'id'>;
  classicPayload?: Omit<Rental, 'id'>;
  equipmentId?: string;
}

type SystemDataImportAnalysis = {
  ok: boolean;
  dryRun: boolean;
  collections: Record<string, { incoming: number; existing: number }>;
  unknownCollections: string[];
  duplicateIds: Record<string, string[]>;
  conflicts: Record<string, string[]>;
  strippedSensitiveFields: number;
  skippedSensitiveSettings: number;
  errors: string[];
  imported?: Record<string, number>;
};

const GANTT_STATUS_IMPORT_MAP: Record<string, GanttRentalData['status']> = {
  active: 'active',
  created: 'created',
  returned: 'returned',
  closed: 'closed',
  'в аренде': 'active',
  'активна': 'active',
  'создана': 'created',
  'бронь': 'created',
  'возвращена': 'returned',
  'закрыта': 'closed',
};

const RENTAL_STATUS_FROM_GANTT: Record<GanttRentalData['status'], Rental['status']> = {
  active: 'active',
  created: 'new',
  returned: 'return_planned',
  closed: 'closed',
};

const PAYMENT_STATUS_IMPORT_MAP: Record<string, GanttRentalData['paymentStatus']> = {
  paid: 'paid',
  unpaid: 'unpaid',
  partial: 'partial',
  'оплачено': 'paid',
  'не оплачено': 'unpaid',
  'частично': 'partial',
};

function formatBackupDateTime(value: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatBackupSize(value: number): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function SystemDataBackupSection({ canManageData }: { canManageData: boolean }) {
  const queryClient = useQueryClient();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [selectedPayload, setSelectedPayload] = React.useState<unknown | null>(null);
  const [selectedFileName, setSelectedFileName] = React.useState('');
  const [analysis, setAnalysis] = React.useState<SystemDataImportAnalysis | null>(null);
  const [message, setMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [backupMessage, setBackupMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [archiveMessage, setArchiveMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isDownloadingBackup, setIsDownloadingBackup] = React.useState(false);
  const [isArchivingExternalPhotos, setIsArchivingExternalPhotos] = React.useState(false);
  const [isExporting, setIsExporting] = React.useState(false);
  const [isChecking, setIsChecking] = React.useState(false);
  const [isImporting, setIsImporting] = React.useState(false);
  const backupHistoryQuery = useQuery<BackupHistoryResponse>({
    queryKey: ['admin-backup-history'],
    queryFn: () => api.get<BackupHistoryResponse>('/api/admin/backup/history'),
    enabled: canManageData,
  });
  const externalPhotoDryRunQuery = useQuery<ExternalPhotoArchiveResponse>({
    queryKey: ['admin-external-photo-archive-dry-run'],
    queryFn: () => api.get<ExternalPhotoArchiveResponse>('/api/admin/media/archive-external-photos/dry-run'),
    enabled: canManageData,
  });

  const handleFullBackupDownload = React.useCallback(async () => {
    setBackupMessage(null);
    setIsDownloadingBackup(true);
    try {
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`${API_BASE_URL}/api/admin/backup/full`, {
        method: 'GET',
        headers,
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(await backupErrorFromResponse(response));
      }
      const blob = await response.blob();
      const filename = filenameFromDisposition(
        response.headers.get('content-disposition'),
        `skytech-backup-${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-')}.zip`,
      );
      downloadBlob(blob, filename);
      setBackupMessage({ type: 'success', text: 'Резервная копия подготовлена и передана браузеру для скачивания.' });
      await backupHistoryQuery.refetch();
    } catch (error) {
      setBackupMessage({ type: 'error', text: backupErrorFromException(error) });
    } finally {
      setIsDownloadingBackup(false);
    }
  }, [backupHistoryQuery]);

  const handleArchiveExternalPhotos = React.useCallback(async () => {
    setArchiveMessage(null);
    const confirmed = window.confirm('Скачать внешние фото с разрешённых доменов и сохранить их в /data/uploads для последующих полных резервных копий? Записи будут дополнены localPath, originalUrl сохранится.');
    if (!confirmed) return;
    setIsArchivingExternalPhotos(true);
    try {
      const result = await api.post<ExternalPhotoArchiveResponse>('/api/admin/media/archive-external-photos', {
        allowDomains: ['i.oneme.ru'],
      });
      setArchiveMessage({
        type: 'success',
        text: `Архивация завершена: сохранено ${result.summary.archived}, пропущено ${result.summary.skipped}, ошибок ${result.summary.failed}.`,
      });
      await externalPhotoDryRunQuery.refetch();
    } catch (error) {
      setArchiveMessage({ type: 'error', text: error instanceof Error ? error.message : 'Не удалось архивировать внешние фото.' });
    } finally {
      setIsArchivingExternalPhotos(false);
    }
  }, [externalPhotoDryRunQuery]);

  const handleExport = React.useCallback(async () => {
    setMessage(null);
    setIsExporting(true);
    try {
      const payload = await api.get<unknown>('/api/admin/system-data/export');
      downloadJSON(payload, `system-data-${new Date().toISOString().slice(0, 10)}.json`);
      setMessage({ type: 'success', text: 'JSON-экспорт системных данных подготовлен.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Не удалось выгрузить системные данные.' });
    } finally {
      setIsExporting(false);
    }
  }, []);

  const handleFileSelected = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setMessage(null);
    setAnalysis(null);
    setSelectedPayload(null);
    setSelectedFileName('');
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      setSelectedPayload(parsed);
      setSelectedFileName(file.name);
      setIsChecking(true);
      const result = await api.post<SystemDataImportAnalysis>('/api/admin/system-data/import/dry-run', parsed);
      setAnalysis(result);
      setMessage({ type: 'success', text: 'Проверка без записи пройдена. Проверьте конфликты перед импортом.' });
    } catch (error) {
      const body = (error as { body?: unknown })?.body as SystemDataImportAnalysis | undefined;
      if (body?.collections) {
        setAnalysis(body);
      }
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Не удалось проверить JSON-файл.' });
    } finally {
      setIsChecking(false);
    }
  }, []);

  const handleImport = React.useCallback(async () => {
    if (!selectedPayload || !analysis?.ok) return;
    setMessage(null);
    setIsImporting(true);
    try {
      const result = await api.post<SystemDataImportAnalysis>('/api/admin/system-data/import', {
        ...(selectedPayload && typeof selectedPayload === 'object' ? selectedPayload as Record<string, unknown> : { collections: {} }),
        confirm: true,
      });
      setAnalysis(result);
      setMessage({ type: 'success', text: 'Импорт выполнен. Данные обновлены из JSON-файла.' });
      await queryClient.invalidateQueries();
    } catch (error) {
      const body = (error as { body?: unknown })?.body as SystemDataImportAnalysis | undefined;
      if (body?.collections) setAnalysis(body);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Не удалось импортировать системные данные.' });
    } finally {
      setIsImporting(false);
    }
  }, [analysis?.ok, queryClient, selectedPayload]);

  const collectionRows = analysis ? Object.entries(analysis.collections) : [];
  const conflictCount = analysis
    ? Object.values(analysis.conflicts || {}).reduce((sum, ids) => sum + ids.length, 0)
    : 0;
  const duplicateCount = analysis
    ? Object.values(analysis.duplicateIds || {}).reduce((sum, ids) => sum + ids.length, 0)
    : 0;

  return (
    <>
    <Card data-testid="full-backup-card">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Резервная копия</CardTitle>
            <CardDescription>
              Резервная копия содержит базу данных и файлы/фото системы. Не отправляйте её в общий чат и не храните в Git.
            </CardDescription>
          </div>
          <Button onClick={() => void handleFullBackupDownload()} disabled={!canManageData || isDownloadingBackup} data-testid="full-backup-download">
            <Download className="h-4 w-4" />
            {isDownloadingBackup ? 'Готовим резервную копию...' : 'Скачать полную резервную копию'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Архив создаётся на сервере на лету и доступен только администраторам. Восстановление из резервной копии в этой версии не выполняется автоматически.
        </p>
        <div className="space-y-2" data-testid="backup-history">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold">История резервных копий</h4>
              <p className="text-xs text-muted-foreground">Показаны последние 5 выгрузок</p>
            </div>
            {backupHistoryQuery.isFetching && (
              <span className="text-xs text-muted-foreground">Обновляем...</span>
            )}
          </div>
          {backupHistoryQuery.isError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              Не удалось загрузить историю резервных копий
            </div>
          ) : backupHistoryQuery.data?.history?.length ? (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Пользователь</TableHead>
                    <TableHead>Файл</TableHead>
                    <TableHead>Размер</TableHead>
                    <TableHead>Состав</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backupHistoryQuery.data.history.slice(0, 5).map(item => (
                    <TableRow key={item.id || `${item.createdAt}-${item.filename}`}>
                      <TableCell className="whitespace-nowrap">{formatBackupDateTime(item.createdAt)}</TableCell>
                      <TableCell>{item.userName || item.userEmail || item.role || '—'}</TableCell>
                      <TableCell className="max-w-[260px] truncate font-mono text-xs">{item.filename || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatBackupSize(item.size)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {item.collectionsCount} коллекций · {item.filesCount} файлов
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
              Резервные копии ещё не скачивали
            </div>
          )}
        </div>
        {backupMessage && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${
            backupMessage.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
          }`}>
            {backupMessage.text}
          </div>
        )}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Архивация внешних фото</CardTitle>
            <CardDescription>
              Фото будут скачаны с внешних ссылок и сохранены в /data/uploads. Записи будут дополнены localPath, originalUrl сохранится. После этого полная резервная копия будет включать сами файлы.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => void externalPhotoDryRunQuery.refetch()}
              disabled={!canManageData || externalPhotoDryRunQuery.isFetching}
            >
              <RefreshCw className="h-4 w-4" />
              Проверить без скачивания
            </Button>
            <Button
              onClick={() => void handleArchiveExternalPhotos()}
              disabled={!canManageData || isArchivingExternalPhotos}
            >
              <Download className="h-4 w-4" />
              {isArchivingExternalPhotos ? 'Скачиваем фото...' : 'Скачать внешние фото в хранилище резервных копий'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {externalPhotoDryRunQuery.isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            Не удалось проверить внешние фото
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border px-4 py-3">
              <p className="text-xs text-muted-foreground">Найдено внешних фото</p>
              <p className="text-2xl font-semibold">{externalPhotoDryRunQuery.data?.summary.found ?? 0}</p>
            </div>
            <div className="rounded-lg border px-4 py-3">
              <p className="text-xs text-muted-foreground">Уже сохранено локально</p>
              <p className="text-2xl font-semibold">{externalPhotoDryRunQuery.data?.summary.alreadyArchived ?? 0}</p>
            </div>
            <div className="rounded-lg border px-4 py-3">
              <p className="text-xs text-muted-foreground">Разрешённые домены</p>
              <p className="truncate text-sm font-medium">{externalPhotoDryRunQuery.data?.allowDomains.join(', ') || 'i.oneme.ru'}</p>
            </div>
            <div className="rounded-lg border px-4 py-3">
              <p className="text-xs text-muted-foreground">Коллекций с фото</p>
              <p className="text-2xl font-semibold">{Object.keys(externalPhotoDryRunQuery.data?.summary.collections || {}).length}</p>
            </div>
          </div>
        )}
        {archiveMessage && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${
            archiveMessage.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
          }`}>
            {archiveMessage.text}
          </div>
        )}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Безопасный экспорт/импорт JSON</CardTitle>
            <CardDescription>
              Выгрузка и восстановление основных коллекций. Пароли, токены и secrets не экспортируются и не принимаются при импорте.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void handleExport()} disabled={!canManageData || isExporting}>
              <Download className="h-4 w-4" />
              {isExporting ? 'Готовим...' : 'Экспорт JSON'}
            </Button>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={!canManageData || isChecking || isImporting}>
              <Upload className="h-4 w-4" />
              Проверить импорт
            </Button>
            <Button onClick={() => void handleImport()} disabled={!canManageData || !analysis?.ok || !selectedPayload || isImporting}>
              {isImporting ? 'Импорт...' : 'Импортировать'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => void handleFileSelected(event)}
        />

        {message && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
          }`}>
            {message.text}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-4">
          <DiagnosticsField label="Файл" value={selectedFileName || 'Не выбран'} />
          <DiagnosticsField label="Статус dry-run" value={
            analysis ? <Badge variant={analysis.ok ? 'success' : 'danger'}>{analysis.ok ? 'Можно импортировать' : 'Есть блокеры'}</Badge> : 'Не выполнен'
          } />
          <DiagnosticsField label="Конфликты id" value={conflictCount} />
          <DiagnosticsField label="Дубликаты id" value={duplicateCount} />
        </div>

        {analysis && (
          <div className="space-y-4">
            {(analysis.errors?.length || analysis.unknownCollections?.length) ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                <p className="font-medium">Импорт заблокирован</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {(analysis.errors || []).map(error => <li key={error}>{error}</li>)}
                </ul>
              </div>
            ) : null}

            {(analysis.strippedSensitiveFields > 0 || analysis.skippedSensitiveSettings > 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                Удалено чувствительных полей: {analysis.strippedSensitiveFields}. Пропущено secret-настроек: {analysis.skippedSensitiveSettings}.
              </div>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Коллекция</TableHead>
                  <TableHead>В файле</TableHead>
                  <TableHead>Сейчас</TableHead>
                  <TableHead>Конфликты</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {collectionRows.map(([name, item]) => (
                  <TableRow key={name}>
                    <TableCell className="font-mono text-xs">{name}</TableCell>
                    <TableCell>{item.incoming}</TableCell>
                    <TableCell>{item.existing}</TableCell>
                    <TableCell>
                      {(analysis.conflicts?.[name]?.length || 0) > 0
                        ? <Badge variant="warning">{analysis.conflicts[name].length}</Badge>
                        : <Badge variant="success">0</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
    </>
  );
}

function DataManagementSection({ canManageData }: { canManageData: boolean }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: equipment = [] } = useQuery({ queryKey: EQUIPMENT_KEYS.all, queryFn: equipmentService.getAll });
  const { data: classicRentals = [] } = useQuery({ queryKey: RENTAL_KEYS.all, queryFn: rentalsService.getAll });
  const { data: ganttRentals = [] } = useQuery({ queryKey: RENTAL_KEYS.gantt, queryFn: rentalsService.getGanttData });
  const { data: clients = [] } = useQuery({ queryKey: ['clients'], queryFn: clientsService.getAll });
  const { data: serviceTickets = [] } = useQuery({ queryKey: SERVICE_TICKET_KEYS.all, queryFn: serviceTicketsService.getAll });
  const [message, setMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isImporting, setIsImporting] = React.useState(false);
  const [isMigratingRepairFacts, setIsMigratingRepairFacts] = React.useState(false);
  const [rentalPreview, setRentalPreview] = React.useState<RentalImportPreviewRow[]>([]);
  const [rentalPreviewOpen, setRentalPreviewOpen] = React.useState(false);
  const [rentalImportFileName, setRentalImportFileName] = React.useState('');
  const equipmentFileInputRef = React.useRef<HTMLInputElement>(null);
  const clientsFileInputRef = React.useRef<HTMLInputElement>(null);
  const serviceFileInputRef = React.useRef<HTMLInputElement>(null);
  const rentalsFileInputRef = React.useRef<HTMLInputElement>(null);

  const handleEquipmentExport = React.useCallback(() => {
    const escapeCSV = (value: string | number | null | undefined) =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;

    const rows = equipment.map(eq => [
      eq.inventoryNumber,
      eq.manufacturer,
      eq.model,
      eq.category,
      eq.activeInFleet ? 'Да' : 'Нет',
      eq.type,
      eq.drive,
      eq.serialNumber,
      eq.year,
      eq.hours,
      eq.liftHeight,
      eq.status,
      eq.location,
      eq.owner,
      eq.subleasePrice ?? '',
      eq.plannedMonthlyRevenue,
      eq.nextMaintenance,
      eq.maintenanceCHTO ?? '',
      eq.maintenancePTO ?? '',
      eq.currentClient ?? '',
      eq.returnDate ?? '',
      eq.notes ?? '',
    ]);

    const csv = [
      [
        'Инв. номер', 'Производитель', 'Модель', 'Категория', 'Активный парк', 'Тип', 'Привод', 'Серийный номер',
        'Год выпуска', 'Наработка', 'Рабочая высота', 'Статус', 'Локация', 'Собственность',
        'Стоимость субаренды', 'План. доход', 'След. ТО', 'ЧТО', 'ПТО',
        'Текущий клиент', 'Дата возврата', 'Примечание',
      ].map(escapeCSV).join(','),
      ...rows.map(row => row.map(escapeCSV).join(',')),
    ].join('\n');

    downloadCSV(csv, `equipment-${new Date().toISOString().slice(0, 10)}.csv`);
    setMessage({ type: 'success', text: `Экспортировано ${equipment.length} записей техники` });
  }, [equipment]);

  const handleEquipmentImportClick = React.useCallback(() => {
    equipmentFileInputRef.current?.click();
  }, []);

  const handleClientsImportClick = React.useCallback(() => {
    clientsFileInputRef.current?.click();
  }, []);

  const handleServiceImportClick = React.useCallback(() => {
    serviceFileInputRef.current?.click();
  }, []);

  const handleRentalsImportClick = React.useCallback(() => {
    rentalsFileInputRef.current?.click();
  }, []);

  const handleRentalsExport = React.useCallback(() => {
    const escapeCSV = (value: string | number | boolean | null | undefined) =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;

    const rows = ganttRentals.map(item => {
      const classic = classicRentals.find(entry =>
        entry.client === item.client &&
        entry.startDate === item.startDate &&
        entry.plannedReturnDate === item.endDate &&
        entry.equipment.includes(item.equipmentInv),
      );
      const eq = equipment.find(entry => entry.id === item.equipmentId)
        || equipment.find(entry => entry.inventoryNumber === item.equipmentInv);
      const note = item.comments?.find(comment => comment.type !== 'system')?.text || classic?.comments || '';
      return [
        item.client,
        classic?.contact || '',
        item.equipmentInv,
        eq?.serialNumber || '',
        item.equipmentId || '',
        item.startDate,
        item.endDate,
        classic?.rate || '',
        item.amount ?? classic?.price ?? 0,
        item.manager || classic?.manager || '',
        item.status,
        item.expectedPaymentDate || '',
        item.paymentStatus,
        item.updSigned ? 'Да' : 'Нет',
        note,
      ];
    });

    const csv = [
      ['Клиент', 'Контакт', 'Инв. номер', 'Серийный номер', 'ID техники', 'Дата начала', 'Дата окончания', 'Ставка', 'Сумма', 'Менеджер', 'Статус', 'Ожидаемая оплата', 'Статус оплаты', 'УПД подписан', 'Комментарий']
        .map(escapeCSV).join(','),
      ...rows.map(row => row.map(escapeCSV).join(',')),
    ].join('\n');

    downloadCSV(csv, `rentals-${new Date().toISOString().slice(0, 10)}.csv`);
    setMessage({ type: 'success', text: `Экспортировано ${ganttRentals.length} аренд` });
  }, [classicRentals, equipment, ganttRentals]);

  const handleRentalsImport = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setMessage(null);
    setIsImporting(true);

    try {
      const text = await file.text();
      const rows = csvToRows(text);
      if (rows.length < 2) throw new Error('Файл пустой или не содержит строк для импорта');

      const inventoryCounts = new Map<string, number>();
      equipment.forEach(item => {
        if (!item.inventoryNumber) return;
        inventoryCounts.set(item.inventoryNumber, (inventoryCounts.get(item.inventoryNumber) || 0) + 1);
      });
      const existingQueue = [...ganttRentals];
      const preview: RentalImportPreviewRow[] = rows.slice(1).map((columns, index) => {
        const line = index + 2;
        const [
          client,
          contact,
          inventoryNumber,
          serialNumber,
          equipmentId,
          startDate,
          endDate,
          rate,
          amountRaw,
          manager,
          statusRaw,
          expectedPaymentDate,
          paymentStatusRaw,
          updSignedRaw,
          comment,
        ] = columns;

        const status = GANTT_STATUS_IMPORT_MAP[(statusRaw || '').toLowerCase()] ?? 'created';
        const paymentStatus = PAYMENT_STATUS_IMPORT_MAP[(paymentStatusRaw || '').toLowerCase()] ?? 'unpaid';
        const amount = Number(amountRaw);

        const clientRecord = clients.find(item => item.company === client);
        if (!client || !clientRecord) {
          return {
            line,
            client: client || '—',
            equipmentLabel: inventoryNumber || serialNumber || equipmentId || '—',
            startDate,
            endDate,
            status: 'error',
            message: 'Клиент не найден в базе',
          };
        }

        const equipmentCandidates = equipment.filter(item => {
          if (equipmentId) return item.id === equipmentId;
          if (serialNumber) return item.serialNumber === serialNumber;
          if (inventoryNumber) {
            return item.inventoryNumber === inventoryNumber
              && (inventoryCounts.get(inventoryNumber) || 0) === 1;
          }
          return false;
        });

        if (equipmentId && equipmentCandidates.length === 0) {
          return {
            line,
            client,
            equipmentLabel: equipmentId,
            startDate,
            endDate,
            status: 'error',
            message: 'Техника по equipmentId не найдена',
          };
        }

        if (!equipmentId && inventoryNumber && (inventoryCounts.get(inventoryNumber) || 0) > 1 && !serialNumber) {
          return {
            line,
            client,
            equipmentLabel: inventoryNumber,
            startDate,
            endDate,
            status: 'conflict',
            message: 'Инвентарный номер неуникален, укажите serialNumber или equipmentId',
          };
        }

        if (equipmentCandidates.length !== 1) {
          return {
            line,
            client,
            equipmentLabel: inventoryNumber || serialNumber || equipmentId || '—',
            startDate,
            endDate,
            status: 'error',
            message: 'Не удалось однозначно определить технику',
          };
        }

        if (!startDate || !endDate || Number.isNaN(new Date(startDate).getTime()) || Number.isNaN(new Date(endDate).getTime())) {
          return {
            line,
            client,
            equipmentLabel: `${equipmentCandidates[0].inventoryNumber} · ${equipmentCandidates[0].model}`,
            startDate,
            endDate,
            status: 'error',
            message: 'Некорректные даты аренды',
          };
        }

        if (new Date(startDate).getTime() > new Date(endDate).getTime()) {
          return {
            line,
            client,
            equipmentLabel: `${equipmentCandidates[0].inventoryNumber} · ${equipmentCandidates[0].model}`,
            startDate,
            endDate,
            status: 'error',
            message: 'Дата окончания раньше даты начала',
          };
        }

        if (!Number.isFinite(amount) || amount < 0) {
          return {
            line,
            client,
            equipmentLabel: `${equipmentCandidates[0].inventoryNumber} · ${equipmentCandidates[0].model}`,
            startDate,
            endDate,
            status: 'error',
            message: 'Некорректная сумма аренды',
          };
        }

        const duplicate = existingQueue.find(item =>
          item.client === client &&
          item.equipmentId === equipmentCandidates[0].id &&
          item.startDate === startDate &&
          item.endDate === endDate,
        );

        if (duplicate) {
          return {
            line,
            client,
            equipmentLabel: `${equipmentCandidates[0].inventoryNumber} · ${equipmentCandidates[0].model}`,
            startDate,
            endDate,
            status: 'duplicate',
            message: `Такая аренда уже существует (${duplicate.id})`,
          };
        }

        const overlap = existingQueue.find(item =>
          item.equipmentId === equipmentCandidates[0].id &&
          item.status !== 'returned' &&
          item.status !== 'closed' &&
          new Date(startDate).getTime() <= new Date(item.endDate).getTime() &&
          new Date(endDate).getTime() >= new Date(item.startDate).getTime(),
        );

        if (overlap) {
          return {
            line,
            client,
            equipmentLabel: `${equipmentCandidates[0].inventoryNumber} · ${equipmentCandidates[0].model}`,
            startDate,
            endDate,
            status: 'conflict',
            message: `Пересечение с арендой ${overlap.id} (${overlap.startDate} — ${overlap.endDate})`,
          };
        }

        const ganttPayload: Omit<GanttRentalData, 'id'> = {
          client,
          clientShort: client.slice(0, 20),
          equipmentId: equipmentCandidates[0].id,
          equipmentInv: equipmentCandidates[0].inventoryNumber,
          startDate,
          endDate,
          manager: manager || '',
          managerInitials: (manager || '').split(/\s+/).map(part => part[0] || '').join('').slice(0, 2).toUpperCase(),
          status,
          paymentStatus,
          updSigned: ['да', 'yes', 'true', '1'].includes((updSignedRaw || '').toLowerCase()),
          expectedPaymentDate: expectedPaymentDate || undefined,
          amount,
          comments: [
            buildRentalCreationHistory({ client, startDate, endDate, status }, user?.name || 'Импорт'),
            ...(comment ? [createRentalHistoryEntry(user?.name || 'Импорт', comment, 'comment')] : []),
          ],
        };

        const classicPayload: Omit<Rental, 'id'> = {
          client,
          contact: contact || clientRecord.contact || '',
          startDate,
          plannedReturnDate: endDate,
          actualReturnDate: undefined,
          equipment: [equipmentCandidates[0].inventoryNumber],
          rate: rate || `${amount} ₽`,
          price: amount,
          discount: 0,
          deliveryAddress: '',
          manager: manager || '',
          status: RENTAL_STATUS_FROM_GANTT[status],
          comments: comment || undefined,
        };

        existingQueue.push({ ...ganttPayload, id: `preview-${line}` });

        return {
          line,
          client,
          equipmentLabel: `${equipmentCandidates[0].inventoryNumber} · ${equipmentCandidates[0].model}`,
          startDate,
          endDate,
          status: 'ready',
          message: 'Готово к импорту',
          ganttPayload,
          classicPayload,
          equipmentId: equipmentCandidates[0].id,
        };
      });

      setRentalImportFileName(file.name);
      setRentalPreview(preview);
      setRentalPreviewOpen(true);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Не удалось подготовить импорт аренд' });
    } finally {
      setIsImporting(false);
    }
  }, [clients, equipment, ganttRentals, user?.name]);

  const applyRentalImport = React.useCallback(async () => {
    const validRows = rentalPreview.filter(item => item.status === 'ready' && item.ganttPayload && item.classicPayload);
    if (validRows.length === 0) {
      setMessage({ type: 'error', text: 'Нет валидных строк для импорта аренд' });
      setRentalPreviewOpen(false);
      return;
    }

    const nextGanttRentals = [...ganttRentals];
    const nextClassicRentals = [...classicRentals];
    let nextEquipment = [...equipment];

    validRows.forEach((row, index) => {
      const ganttId = `GR-IMPORT-${Date.now()}-${index}`;
      const rentalId = `R-IMPORT-${Date.now()}-${index}`;
      nextClassicRentals.push({ ...row.classicPayload!, id: rentalId });
      nextGanttRentals.push({ ...row.ganttPayload!, id: ganttId, rentalId });
      if (row.equipmentId) {
        nextEquipment = nextEquipment.map(item => {
          if (item.id !== row.equipmentId) return item;
          const nextStatus: EquipmentStatus = row.ganttPayload!.status === 'active' ? 'rented' : 'reserved';
          return appendAuditHistory(
            {
              ...item,
              status: nextStatus,
              currentClient: row.ganttPayload!.status === 'active' ? row.client : item.currentClient,
              returnDate: row.ganttPayload!.status === 'active' ? row.endDate : item.returnDate,
            },
            createAuditEntry(user?.name || 'Импорт', `Импорт аренды ${ganttId} из CSV`),
          );
        });
      }
    });

    try {
      await Promise.all([
        rentalsService.bulkReplaceGantt(nextGanttRentals),
        rentalsService.bulkReplace(nextClassicRentals),
        equipmentService.bulkReplace(nextEquipment),
      ]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt }),
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all }),
      ]);
      setRentalPreviewOpen(false);
      setRentalPreview([]);
      setMessage({ type: 'success', text: `Импорт аренд завершён: добавлено ${validRows.length} записей` });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Не удалось выполнить импорт аренд' });
    }
  }, [classicRentals, equipment, ganttRentals, queryClient, rentalPreview, user?.name]);

  const handleEquipmentImport = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setMessage(null);
    setIsImporting(true);

    try {
      const text = await file.text();
      const rows = csvToRows(text);
      if (rows.length < 2) throw new Error('Файл пустой или не содержит строк для импорта');

      const importedItems = rows.slice(1).map((columns, index) => {
        const [
          inventoryNumber,
          manufacturer,
          model,
          categoryRaw,
          activeInFleetRaw,
          typeRaw,
          driveRaw,
          serialNumber,
          yearRaw,
          hoursRaw,
          liftHeightRaw,
          statusRaw,
          location,
          ownerRaw,
          subleasePriceRaw,
          plannedMonthlyRevenueRaw,
          nextMaintenance,
          maintenanceCHTO,
          maintenancePTO,
          currentClient,
          returnDate,
          notes,
        ] = columns;

        const type = TYPE_IMPORT_MAP[(typeRaw || '').toLowerCase()] || typeRaw;
        const drive = DRIVE_IMPORT_MAP[(driveRaw || '').toLowerCase()];
        const status = STATUS_IMPORT_MAP[(statusRaw || '').toLowerCase()] ?? 'available';
        const owner = OWNER_IMPORT_MAP[(ownerRaw || '').toLowerCase()] ?? 'own';
        const category = CATEGORY_IMPORT_MAP[(categoryRaw || '').toLowerCase()] ?? 'own';
        const activeInFleet = activeInFleetRaw
          ? ['да', 'yes', 'true', '1'].includes(activeInFleetRaw.toLowerCase())
          : true;

        if (!inventoryNumber || !manufacturer || !model || !serialNumber || !type || !drive || !location) {
          throw new Error(`Строка ${index + 2}: не заполнены обязательные поля или неизвестный привод`);
        }

        return {
          id: `eq-import-${Date.now()}-${index}`,
          inventoryNumber,
          manufacturer,
          model,
          type,
          drive,
          serialNumber,
          category,
          activeInFleet,
          year: Number(yearRaw) || new Date().getFullYear(),
          hours: Number(hoursRaw) || 0,
          liftHeight: Number(liftHeightRaw) || 0,
          location,
          status,
          owner,
          subleasePrice: subleasePriceRaw ? Number(subleasePriceRaw) : undefined,
          plannedMonthlyRevenue: Number(plannedMonthlyRevenueRaw) || 0,
          nextMaintenance: nextMaintenance || new Date().toISOString().slice(0, 10),
          maintenanceCHTO: maintenanceCHTO || undefined,
          maintenancePTO: maintenancePTO || undefined,
          currentClient: currentClient || undefined,
          returnDate: returnDate || undefined,
          notes: notes || undefined,
        } satisfies Equipment;
      });

      const existingByInv = new Map(equipment.map(item => [item.inventoryNumber, item]));
      const merged = [...equipment];
      let created = 0;
      let updated = 0;

      for (const imported of importedItems) {
        const existing = existingByInv.get(imported.inventoryNumber);
        if (existing) {
          const next = { ...existing, ...imported, id: existing.id };
          const idx = merged.findIndex(item => item.id === existing.id);
          if (idx >= 0) merged[idx] = next;
          updated++;
        } else {
          merged.push(imported);
          created++;
        }
      }

      await equipmentService.bulkReplace(merged);
      await queryClient.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all });
      setMessage({ type: 'success', text: `Импорт завершён: добавлено ${created}, обновлено ${updated}` });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Не удалось импортировать CSV';
      setMessage({ type: 'error', text: messageText });
    } finally {
      setIsImporting(false);
    }
  }, [equipment, queryClient]);

  const handleClientsExport = React.useCallback(() => {
    const escapeCSV = (value: string | number | null | undefined) =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;

    const rows = clients.map(client => [
      client.company,
      client.inn,
      client.contact,
      client.phone,
      client.email,
      client.address ?? '',
      client.paymentTerms,
      client.creditLimit,
      client.debt,
      client.totalRentals,
      client.manager ?? '',
      client.status ?? 'active',
      client.notes ?? '',
      client.createdAt ?? '',
      client.createdBy ?? '',
    ]);

    const csv = [
      ['Компания', 'ИНН', 'Контакт', 'Телефон', 'Email', 'Адрес', 'Условия оплаты', 'Кредитный лимит', 'Долг', 'Кол-во аренд', 'Менеджер', 'Статус', 'Примечание', 'Создан', 'Создал']
        .map(escapeCSV).join(','),
      ...rows.map(row => row.map(escapeCSV).join(',')),
    ].join('\n');

    downloadCSV(csv, `clients-${new Date().toISOString().slice(0, 10)}.csv`);
    setMessage({ type: 'success', text: `Экспортировано ${clients.length} клиентов` });
  }, [clients]);

  const handleClientsImport = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setMessage(null);
    setIsImporting(true);

    try {
      const text = await file.text();
      const rows = csvToRows(text);
      if (rows.length < 2) throw new Error('Файл пустой или не содержит строк для импорта');

      const importedItems = rows.slice(1).map((columns, index) => {
        const [
          company,
          inn,
          contact,
          phone,
          email,
          address,
          paymentTerms,
          creditLimitRaw,
          debtRaw,
          totalRentalsRaw,
          manager,
          statusRaw,
          notes,
          createdAt,
          createdBy,
        ] = columns;

        if (!company || !inn || !contact || !phone || !email || !paymentTerms) {
          throw new Error(`Строка ${index + 2}: не заполнены обязательные поля клиента`);
        }

        return {
          id: `client-import-${Date.now()}-${index}`,
          company,
          inn,
          contact,
          phone,
          email,
          address: address || undefined,
          paymentTerms,
          creditLimit: Number(creditLimitRaw) || 0,
          debt: Number(debtRaw) || 0,
          totalRentals: Number(totalRentalsRaw) || 0,
          manager: manager || undefined,
          status: CLIENT_STATUS_IMPORT_MAP[(statusRaw || '').toLowerCase()] ?? 'active',
          notes: notes || undefined,
          createdAt: createdAt || undefined,
          createdBy: createdBy || undefined,
        } satisfies Client;
      });

      const existingByInn = new Map(clients.map(item => [item.inn, item]));
      const merged = [...clients];
      let created = 0;
      let updated = 0;

      for (const imported of importedItems) {
        const existing = existingByInn.get(imported.inn);
        if (existing) {
          const next = { ...existing, ...imported, id: existing.id };
          const idx = merged.findIndex(item => item.id === existing.id);
          if (idx >= 0) merged[idx] = next;
          updated++;
        } else {
          merged.push(imported);
          created++;
        }
      }

      await clientsService.bulkReplace(merged);
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      setMessage({ type: 'success', text: `Импорт клиентов завершён: добавлено ${created}, обновлено ${updated}` });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Не удалось импортировать клиентов';
      setMessage({ type: 'error', text: messageText });
    } finally {
      setIsImporting(false);
    }
  }, [clients, queryClient]);

  const handleServiceExport = React.useCallback(() => {
    const escapeCSV = (value: string | number | null | undefined) =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;

    const rows = serviceTickets.map(ticket => [
      ticket.equipmentId,
      ticket.equipment,
      ticket.inventoryNumber ?? '',
      ticket.serialNumber ?? '',
      ticket.equipmentType ?? '',
      ticket.equipmentTypeLabel ?? '',
      ticket.location ?? '',
      ticket.reason,
      ticket.description,
      ticket.priority,
      ticket.sla,
      ticket.assignedTo ?? '',
      ticket.assignedMechanicId ?? '',
      ticket.assignedMechanicName ?? '',
      ticket.createdBy ?? '',
      ticket.createdByUserId ?? '',
      ticket.createdByUserName ?? '',
      ticket.reporterContact ?? '',
      ticket.source ?? '',
      ticket.status,
      ticket.plannedDate ?? '',
      ticket.closedAt ?? '',
      ticket.result ?? '',
      JSON.stringify(ticket.resultData ?? null),
      JSON.stringify(ticket.workLog ?? []),
      JSON.stringify(ticket.parts ?? []),
      ticket.createdAt,
      JSON.stringify(ticket.photos ?? []),
    ]);

    const csv = [
      ['ID техники', 'Техника', 'Инв. номер', 'Серийный номер', 'Код типа техники', 'Тип техники', 'Локация', 'Причина', 'Описание', 'Приоритет', 'SLA', 'Назначен', 'ID механика', 'Имя механика', 'Создал', 'ID автора', 'Имя автора', 'Контактное лицо', 'Источник', 'Статус', 'Плановая дата', 'Дата закрытия', 'Результат', 'Результат JSON', 'Журнал работ JSON', 'Запчасти JSON', 'Создано', 'Фото JSON']
        .map(escapeCSV).join(','),
      ...rows.map(row => row.map(escapeCSV).join(',')),
    ].join('\n');

    downloadCSV(csv, `service-${new Date().toISOString().slice(0, 10)}.csv`);
    setMessage({ type: 'success', text: `Экспортировано ${serviceTickets.length} сервисных заявок` });
  }, [serviceTickets]);

  const handleServiceImport = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setMessage(null);
    setIsImporting(true);

    try {
      const text = await file.text();
      const rows = csvToRows(text);
      if (rows.length < 2) throw new Error('Файл пустой или не содержит строк для импорта');

      const importedItems = rows.slice(1).map((columns, index) => {
        const [
          equipmentId,
          equipmentName,
          inventoryNumber,
          serialNumber,
          equipmentType,
          equipmentTypeLabel,
          location,
          reason,
          description,
          priority,
          sla,
          assignedTo,
          assignedMechanicId,
          assignedMechanicName,
          createdBy,
          createdByUserId,
          createdByUserName,
          reporterContact,
          source,
          statusRaw,
          plannedDate,
          closedAt,
          result,
          resultDataRaw,
          workLogRaw,
          partsRaw,
          createdAt,
          photosRaw,
        ] = columns;

        if (!equipmentId || !equipmentName || !reason || !description || !priority || !sla) {
          throw new Error(`Строка ${index + 2}: не заполнены обязательные поля сервисной заявки`);
        }

        const parseJsonArray = <T,>(raw: string, fallback: T[]): T[] => {
          if (!raw) return fallback;
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed as T[] : fallback;
          } catch {
            return fallback;
          }
        };

        return {
          id: `service-import-${Date.now()}-${index}`,
          equipmentId,
          equipment: equipmentName,
          inventoryNumber: inventoryNumber || undefined,
          serialNumber: serialNumber || undefined,
          equipmentType: equipmentType || undefined,
          equipmentTypeLabel: equipmentTypeLabel || undefined,
          location: location || undefined,
          reason,
          description,
          priority: priority as ServiceTicket['priority'],
          sla,
          assignedTo: assignedTo || undefined,
          assignedMechanicId: assignedMechanicId || undefined,
          assignedMechanicName: assignedMechanicName || undefined,
          createdBy: createdBy || undefined,
          createdByUserId: createdByUserId || undefined,
          createdByUserName: createdByUserName || undefined,
          reporterContact: reporterContact || undefined,
          source: (source || undefined) as ServiceTicket['source'],
          status: SERVICE_STATUS_IMPORT_MAP[(statusRaw || '').toLowerCase()] ?? 'new',
          plannedDate: plannedDate || undefined,
          closedAt: closedAt || undefined,
          result: result || undefined,
          resultData: resultDataRaw ? (() => {
            try { return JSON.parse(resultDataRaw); } catch { return undefined; }
          })() : undefined,
          workLog: parseJsonArray(workLogRaw, []),
          parts: parseJsonArray(partsRaw, []),
          createdAt: createdAt || new Date().toISOString(),
          photos: parseJsonArray(photosRaw, []),
        } satisfies ServiceTicket;
      });

      const existingByCompositeKey = new Map(
        serviceTickets.map(item => [`${item.equipmentId}::${item.reason}::${item.createdAt}`, item]),
      );
      const merged = [...serviceTickets];
      let created = 0;
      let updated = 0;

      for (const imported of importedItems) {
        const key = `${imported.equipmentId}::${imported.reason}::${imported.createdAt}`;
        const existing = existingByCompositeKey.get(key);
        if (existing) {
          const next = { ...existing, ...imported, id: existing.id };
          const idx = merged.findIndex(item => item.id === existing.id);
          if (idx >= 0) merged[idx] = next;
          updated++;
        } else {
          merged.push(imported);
          created++;
        }
      }

      await serviceTicketsService.bulkReplace(merged);
      await queryClient.invalidateQueries({ queryKey: SERVICE_TICKET_KEYS.all });
      setMessage({ type: 'success', text: `Импорт сервиса завершён: добавлено ${created}, обновлено ${updated}` });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Не удалось импортировать сервисные заявки';
      setMessage({ type: 'error', text: messageText });
    } finally {
      setIsImporting(false);
    }
  }, [queryClient, serviceTickets]);

  const handleRepairFactsMigration = React.useCallback(async () => {
    setMessage(null);
    setIsMigratingRepairFacts(true);
    try {
      const result = await reportsService.migrateRepairFacts();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reports', 'mechanicsWorkload'] }),
        queryClient.invalidateQueries({ queryKey: SERVICE_TICKET_KEYS.all }),
      ]);
      setMessage({
        type: 'success',
        text: `Миграция завершена: проверено заявок ${result.ticketsScanned}, перенесено работ ${result.migratedWorkItems}, запчастей ${result.migratedPartItems}, создано справочных работ ${result.createdWorkRefs}, запчастей ${result.createdPartRefs}`,
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Не удалось запустить миграцию';
      setMessage({ type: 'error', text: messageText });
    } finally {
      setIsMigratingRepairFacts(false);
    }
  }, [queryClient]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Управление данными</CardTitle>
        <CardDescription>Импорт и экспорт справочников и рабочих данных. Доступно только администратору.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {message && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
          }`}>
            {message.text}
          </div>
        )}

        <input
          ref={equipmentFileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleEquipmentImport}
          disabled={!canManageData || isImporting}
        />
        <input
          ref={clientsFileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleClientsImport}
          disabled={!canManageData || isImporting}
        />
        <input
          ref={serviceFileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleServiceImport}
          disabled={!canManageData || isImporting}
        />
        <input
          ref={rentalsFileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleRentalsImport}
          disabled={!canManageData || isImporting}
        />

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Техника</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Экспорт и импорт карточек техники. Сейчас в системе {equipment.length} записей.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={handleEquipmentExport} disabled={!canManageData}>
                <Download className="h-4 w-4" />
                Экспорт
              </Button>
              <Button variant="secondary" size="sm" onClick={handleEquipmentImportClick} disabled={!canManageData || isImporting}>
                <Upload className="h-4 w-4" />
                {isImporting ? 'Импорт...' : 'Импорт'}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Клиенты</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Экспорт и импорт клиентской базы. Сейчас в системе {clients.length} записей.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={handleClientsExport} disabled={!canManageData}>
                <Download className="h-4 w-4" />
                Экспорт
              </Button>
              <Button variant="secondary" size="sm" onClick={handleClientsImportClick} disabled={!canManageData || isImporting}>
                <Upload className="h-4 w-4" />
                {isImporting ? 'Импорт...' : 'Импорт'}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Аренды</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Экспорт и импорт аренд с предпросмотром конфликтов. Сейчас в системе {ganttRentals.length} записей планировщика.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={handleRentalsExport} disabled={!canManageData}>
                <Download className="h-4 w-4" />
                Экспорт
              </Button>
              <Button variant="secondary" size="sm" onClick={handleRentalsImportClick} disabled={!canManageData || isImporting}>
                <Upload className="h-4 w-4" />
                {isImporting ? 'Импорт...' : 'Импорт'}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Сервис</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Экспорт и импорт сервисных заявок. Сейчас в системе {serviceTickets.length} записей.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={handleServiceExport} disabled={!canManageData}>
                <Download className="h-4 w-4" />
                Экспорт
              </Button>
              <Button variant="secondary" size="sm" onClick={handleServiceImportClick} disabled={!canManageData || isImporting}>
                <Upload className="h-4 w-4" />
                {isImporting ? 'Импорт...' : 'Импорт'}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Миграция истории ремонтов</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Ручной перенос legacy-работ и запчастей из старых заявок в отдельные fact-коллекции для аналитики сервиса.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => void handleRepairFactsMigration()} disabled={!canManageData || isMigratingRepairFacts}>
                <RefreshCw className={`h-4 w-4 ${isMigratingRepairFacts ? 'animate-spin' : ''}`} />
                {isMigratingRepairFacts ? 'Миграция...' : 'Запустить миграцию'}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>

      <Dialog open={rentalPreviewOpen} onOpenChange={setRentalPreviewOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Предпросмотр импорта аренд {rentalImportFileName ? `· ${rentalImportFileName}` : ''}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
              <p className="text-xs text-gray-500 dark:text-gray-400">Всего строк</p>
              <p className="text-lg font-semibold">{rentalPreview.length}</p>
            </div>
            <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20 px-3 py-2">
              <p className="text-xs text-green-700 dark:text-green-300">Готово к импорту</p>
              <p className="text-lg font-semibold">{rentalPreview.filter(item => item.status === 'ready').length}</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-3 py-2">
              <p className="text-xs text-amber-700 dark:text-amber-300">Конфликт/дубликат</p>
              <p className="text-lg font-semibold">{rentalPreview.filter(item => item.status === 'conflict' || item.status === 'duplicate').length}</p>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 px-3 py-2">
              <p className="text-xs text-red-700 dark:text-red-300">Ошибки</p>
              <p className="text-lg font-semibold">{rentalPreview.filter(item => item.status === 'error').length}</p>
            </div>
          </div>
          <div className="max-h-[420px] overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Строка</TableHead>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Техника</TableHead>
                  <TableHead>Период</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Комментарий</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rentalPreview.map(row => (
                  <TableRow key={`${row.line}-${row.client}-${row.equipmentLabel}`}>
                    <TableCell>{row.line}</TableCell>
                    <TableCell>{row.client}</TableCell>
                    <TableCell>{row.equipmentLabel}</TableCell>
                    <TableCell>{row.startDate} — {row.endDate}</TableCell>
                    <TableCell>
                      <Badge variant={
                        row.status === 'ready'
                          ? 'success'
                          : row.status === 'duplicate'
                            ? 'secondary'
                            : row.status === 'conflict'
                              ? 'warning'
                              : 'danger'
                      }>
                        {row.status === 'ready' ? 'Готово' : row.status === 'duplicate' ? 'Дубликат' : row.status === 'conflict' ? 'Конфликт' : 'Ошибка'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500 dark:text-gray-400">{row.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRentalPreviewOpen(false)}>Отмена</Button>
            <Button onClick={() => void applyRentalImport()} disabled={rentalPreview.filter(item => item.status === 'ready').length === 0}>
              Импортировать валидные строки
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Сброс тестовых данных ─────────────────────────────────────────────────────

interface DataCounts {
  ganttRentals: number;
  classicRentals: number;
  deliveries: number;
  serviceTickets: number;
  clients: number;
  payments: number;
  documents: number;
  shippingPhotos: number;
  equipment: number;
}

function DataResetSection() {
  const queryClient = useQueryClient();
  const { data: classicRentals = [] } = useQuery({ queryKey: RENTAL_KEYS.all, queryFn: rentalsService.getAll });
  const { data: ganttRentals = [] } = useQuery({ queryKey: RENTAL_KEYS.gantt, queryFn: rentalsService.getGanttData });
  const { data: serviceTickets = [] } = useQuery({ queryKey: SERVICE_TICKET_KEYS.all, queryFn: serviceTicketsService.getAll });
  const { data: clients = [] } = useQuery({ queryKey: ['clients'], queryFn: clientsService.getAll });
  const { data: payments = [] } = useQuery({ queryKey: PAYMENT_KEYS.all, queryFn: paymentsService.getAll });
  const { data: documents = [] } = useQuery({ queryKey: ['documents'], queryFn: documentsService.getAll });
  const { data: deliveries = [] } = useQuery({ queryKey: ['deliveries'], queryFn: deliveriesService.getAll });
  const { data: shippingPhotos = [] } = useQuery({ queryKey: ['shippingPhotos', 'all'], queryFn: equipmentService.getAllShippingPhotos });
  const { data: equipment = [] } = useQuery({ queryKey: EQUIPMENT_KEYS.all, queryFn: equipmentService.getAll });
  const [dialogOpen, setDialogOpen]   = React.useState(false);
  const [confirmText, setConfirmText] = React.useState('');
  const [done, setDone]               = React.useState(false);
  const [resetting, setResetting]     = React.useState(false);

  const counts = React.useMemo<DataCounts>(() => {
    return {
      ganttRentals: ganttRentals.length,
      classicRentals: classicRentals.length,
      deliveries: deliveries.length,
      serviceTickets: serviceTickets.length,
      clients: clients.length,
      payments: payments.length,
      documents: documents.length,
      shippingPhotos: shippingPhotos.length,
      equipment: equipment.length,
    };
  }, [classicRentals, ganttRentals, deliveries, serviceTickets, clients, payments, documents, shippingPhotos, equipment]);

  const totalToDelete =
    counts.ganttRentals + counts.classicRentals + counts.deliveries + counts.serviceTickets +
    counts.clients + counts.payments + counts.documents + counts.shippingPhotos;

  const canConfirm = confirmText.trim().toLowerCase() === 'сброс';

  const handleOpenDialog = () => {
    setConfirmText('');
    setDone(false);
    setDialogOpen(true);
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await Promise.all([
        rentalsService.bulkReplace([]),
        rentalsService.bulkReplaceGantt([]),
        Promise.all(deliveries.map(item => deliveriesService.delete(item.id))),
        serviceTicketsService.bulkReplace([]),
        clientsService.bulkReplace([]),
        paymentsService.bulkReplace([]),
        documentsService.bulkReplace([]),
        equipmentService.bulkReplaceShippingPhotos([]),
      ]);

      const resetEquipment = equipment.map(eq => {
        const { currentClient: _cc, returnDate: _rd, ...rest } = eq;
        return { ...rest, status: 'available' as const };
      });
      await equipmentService.bulkReplace(resetEquipment);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt }),
        queryClient.invalidateQueries({ queryKey: ['deliveries'] }),
        queryClient.invalidateQueries({ queryKey: SERVICE_TICKET_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: ['clients'] }),
        queryClient.invalidateQueries({ queryKey: PAYMENT_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
        queryClient.invalidateQueries({ queryKey: ['shippingPhotos'] }),
        queryClient.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all }),
      ]);
      setDone(true);
    } finally {
      setResetting(false);
    }
  };

  const deletableRows: { label: string; count: number; key: string }[] = [
    { key: 'ganttRentals',  label: 'Аренды (планировщик)',     count: counts.ganttRentals },
    { key: 'classicRentals',label: 'Аренды (классические)',    count: counts.classicRentals },
    { key: 'deliveries',    label: 'Доставки',                 count: counts.deliveries },
    { key: 'serviceTickets',label: 'Сервисные заявки',         count: counts.serviceTickets },
    { key: 'clients',       label: 'Клиенты',                  count: counts.clients },
    { key: 'payments',      label: 'Платежи',                  count: counts.payments },
    { key: 'documents',     label: 'Документы',                count: counts.documents },
    { key: 'shippingPhotos',label: 'Фото отгрузки/приёмки',   count: counts.shippingPhotos },
  ];

  const keptRows = [
    { label: 'Пользователи и роли',     desc: 'Учётные записи и права доступа' },
    { label: 'Собственники техники',    desc: 'Справочник владельцев' },
    { label: `Техника (${counts.equipment} ед.)`, desc: 'Карточки сохраняются, статус → Свободна, арендатор и дата возврата очищаются' },
  ];

  return (
    <div className="space-y-6">
      {/* Информационный баннер */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-700/50 dark:bg-amber-900/20 p-4">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="text-sm text-amber-800 dark:text-amber-300">
          <p className="font-semibold mb-1">Зона администрирования</p>
          <p>Эта вкладка предназначена для очистки тестовых данных перед началом реальной работы с системой. Действие необратимо — данные восстановить невозможно.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Что будет удалено */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <Trash2 className="h-5 w-5" />
              Будет удалено
            </CardTitle>
            <CardDescription>Транзакционные данные, накопленные в процессе тестирования</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {deletableRows.map(row => (
                <div key={row.key} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                  <span className="text-sm text-gray-700 dark:text-gray-300">{row.label}</span>
                  <span className={`min-w-[2rem] text-right text-sm font-bold tabular-nums ${row.count > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                    {row.count}
                  </span>
                </div>
              ))}
              <div className="mt-3 flex items-center justify-between rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 px-3 py-2">
                <span className="text-sm font-semibold text-red-700 dark:text-red-300">Итого записей к удалению</span>
                <span className="text-sm font-bold text-red-700 dark:text-red-300 tabular-nums">{totalToDelete}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Что останется */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              Будет сохранено
            </CardTitle>
            <CardDescription>Справочники и системные настройки останутся нетронутыми</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {keptRows.map(row => (
                <div key={row.label} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{row.label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{row.desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Кнопка сброса / результат */}
      <Card>
        <CardContent className="pt-6">
          {done ? (
            <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 dark:border-green-700/50 dark:bg-green-900/20 p-4">
              <CheckCircle2 className="h-6 w-6 shrink-0 text-green-600 dark:text-green-400" />
              <div>
                <p className="font-semibold text-green-800 dark:text-green-300">Данные успешно сброшены</p>
                <p className="text-sm text-green-700 dark:text-green-400 mt-0.5">
                  Система готова к реальной эксплуатации. Вся техника переведена в статус «Свободна».
                </p>
              </div>
              <button
                onClick={() => { setDone(false); }}
                className="ml-auto rounded p-1 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/40"
                title="Обновить"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <p className="font-medium text-gray-900 dark:text-white">Сброс тестовых данных</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  {totalToDelete > 0
                    ? `Будет удалено ${totalToDelete} записей. Это действие нельзя отменить.`
                    : 'Транзакционных данных нет — система уже чистая.'}
                </p>
              </div>
              <button
                onClick={handleOpenDialog}
                className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40 transition-colors"
              >
                <AlertTriangle className="h-4 w-4" />
                Сбросить тестовые данные
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Диалог подтверждения */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) setDialogOpen(false); }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-5 w-5" />
              Подтверждение сброса данных
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-700/50 dark:bg-red-900/20 p-4 text-sm text-red-800 dark:text-red-300">
              <p className="font-semibold mb-2">Внимание! Это действие необратимо.</p>
              <p>Будет удалено <strong>{totalToDelete} записей</strong>:</p>
              <ul className="mt-2 space-y-1 list-disc list-inside">
                {deletableRows.filter(r => r.count > 0).map(r => (
                  <li key={r.key}>{r.label}: <strong>{r.count}</strong></li>
                ))}
              </ul>
              <p className="mt-3">Вся техника ({counts.equipment} ед.) будет переведена в статус <strong>«Свободна»</strong>.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Введите слово <strong>СБРОС</strong> для подтверждения:
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="СБРОС"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Отмена</Button>
            </DialogClose>
            <button
              onClick={() => { void handleReset(); setDialogOpen(false); }}
              disabled={!canConfirm || resetting}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            >
              {resetting && <RefreshCw className="h-4 w-4 animate-spin" />}
              Подтвердить сброс
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Справочник собственников (с персистентностью в localStorage) ──────────────

function OwnersReferenceList() {
  const queryClient = useQueryClient();
  const { data: ownersData = [] } = useQuery<Owner[]>({
    queryKey: ['owners'],
    queryFn: ownersService.getAll,
  });
  const [owners, setOwnersState] = React.useState<Owner[]>([]);
  const [adding,     setAdding]    = React.useState(false);
  const [newValue,   setNewValue]  = React.useState('');
  const [editId,     setEditId]    = React.useState<string | null>(null);
  const [editValue,  setEditValue] = React.useState('');

  React.useEffect(() => {
    setOwnersState(ownersData);
  }, [ownersData]);

  const persist = async (next: Owner[]) => {
    setOwnersState(next);
    localStorage.setItem('app_owners', JSON.stringify(next));
    await ownersService.bulkReplace(next);
    await queryClient.invalidateQueries({ queryKey: ['owners'] });
  };

  const handleAdd = () => {
    if (!newValue.trim()) return;
    void persist([...owners, { id: `own-${Date.now()}`, name: newValue.trim() }]);
    setNewValue('');
    setAdding(false);
  };

  const handleEditSave = (id: string) => {
    if (!editValue.trim()) return;
    void persist(owners.map(o => o.id === id ? { ...o, name: editValue.trim() } : o));
    setEditId(null);
  };

  const handleDelete = (id: string) => {
    void persist(owners.filter(o => o.id !== id));
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Собственники техники</CardTitle>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)} title="Добавить собственника">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {owners.length === 0 && !adding && (
            <p className="py-4 text-center text-sm text-gray-400 dark:text-gray-500">
              Нет собственников. Нажмите «+» чтобы добавить.
            </p>
          )}
          {owners.map(owner => (
            <div
              key={owner.id}
              className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-3"
            >
              {editId === owner.id ? (
                <input
                  autoFocus
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  handleEditSave(owner.id);
                    if (e.key === 'Escape') setEditId(null);
                  }}
                  className="flex-1 mr-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                />
              ) : (
                <span className="text-sm font-medium flex-1">{owner.name}</span>
              )}
              <div className="flex gap-1">
                {editId === owner.id ? (
                  <>
                    <button
                      onClick={() => handleEditSave(owner.id)}
                      className="rounded px-2 py-1 text-xs bg-[--color-primary] text-white hover:opacity-90"
                    >
                      OK
                    </button>
                    <button
                      onClick={() => setEditId(null)}
                      className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => { setEditId(owner.id); setEditValue(owner.name); }}
                      className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                      title="Редактировать"
                    >
                      <Edit className="h-4 w-4 text-gray-500" />
                    </button>
                    <button
                      onClick={() => handleDelete(owner.id)}
                      className="rounded p-1 hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="Удалить"
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}

          {adding && (
            <div className="flex gap-2">
              <input
                autoFocus
                value={newValue}
                onChange={e => setNewValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter')  handleAdd();
                  if (e.key === 'Escape') setAdding(false);
                }}
                placeholder="Например: ООО «Скайтех компани»"
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[--color-primary]"
              />
              <Button size="sm" onClick={handleAdd}>OK</Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>✕</Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function statusLabel(status: ReferenceStatus) {
  return status === 'active' ? 'Активен' : 'Отключен';
}

function statusVariant(status: ReferenceStatus): 'success' | 'secondary' {
  return status === 'active' ? 'success' : 'secondary';
}

function MechanicsReferenceList() {
  const queryClient = useQueryClient();
  const { data: mechanicsData = [] } = useQuery<Mechanic[]>({
    queryKey: ['mechanics'],
    queryFn: mechanicsService.getAll,
  });
  const [mechanics, setMechanics] = React.useState<Mechanic[]>([]);
  const [draft, setDraft] = React.useState({ name: '', phone: '', notes: '' });

  React.useEffect(() => setMechanics(mechanicsData), [mechanicsData]);

  const persist = async (next: Mechanic[]) => {
    setMechanics(next);
    await mechanicsService.bulkReplace(next);
    await queryClient.invalidateQueries({ queryKey: ['mechanics'] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Механики</CardTitle>
        <CardDescription>Справочник исполнителей для сервисных заявок</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {mechanics.map(mechanic => (
          <div key={mechanic.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{mechanic.name}</p>
                {mechanic.phone && <p className="text-xs text-gray-500">{mechanic.phone}</p>}
                {mechanic.notes && <p className="mt-1 text-xs text-gray-500">{mechanic.notes}</p>}
              </div>
              <Badge variant={statusVariant(mechanic.status)}>{statusLabel(mechanic.status)}</Badge>
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => void persist(mechanics.map(item => item.id === mechanic.id ? { ...item, status: item.status === 'active' ? 'inactive' : 'active' } : item))}>
                {mechanic.status === 'active' ? 'Отключить' : 'Включить'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void persist(mechanics.filter(item => item.id !== mechanic.id))}>
                Удалить
              </Button>
            </div>
          </div>
        ))}

        <div className="rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-700">
          <p className="mb-2 text-sm font-medium">Добавить механика</p>
          <div className="space-y-2">
            <Input placeholder="ФИО" value={draft.name} onChange={e => setDraft(prev => ({ ...prev, name: e.target.value }))} />
            <Input placeholder="Телефон" value={draft.phone} onChange={e => setDraft(prev => ({ ...prev, phone: e.target.value }))} />
            <Input placeholder="Примечание" value={draft.notes} onChange={e => setDraft(prev => ({ ...prev, notes: e.target.value }))} />
            <Button
              size="sm"
              onClick={() => {
                if (!draft.name.trim()) return;
                void persist([
                  ...mechanics,
                  { id: `mech-${Date.now()}`, name: draft.name.trim(), phone: draft.phone.trim() || undefined, notes: draft.notes.trim() || undefined, status: 'active' },
                ]);
                setDraft({ name: '', phone: '', notes: '' });
              }}
            >
              Добавить
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DeliveryCarriersReferenceList() {
  const queryClient = useQueryClient();
  const { data: carriersData = [] } = useQuery<DeliveryCarrier[]>({
    queryKey: ['deliveryCarriers'],
    queryFn: deliveryCarriersService.getAll,
  });
  const { data: users = [] } = useQuery<SystemUser[]>({
    queryKey: ['users'],
    queryFn: usersService.getAll,
  });
  const { data: connections = [] } = useQuery<DeliveryCarrierConnection[]>({
    queryKey: ['deliveryCarrierConnections'],
    queryFn: deliveryCarriersService.getConnections,
  });
  const [carriers, setCarriers] = React.useState<DeliveryCarrier[]>([]);
  const [showOnlyConnected, setShowOnlyConnected] = React.useState(false);
  const [draft, setDraft] = React.useState({ name: '', company: '', inn: '', phone: '', notes: '', systemUserId: '', maxCarrierKey: '' });

  React.useEffect(() => {
    setCarriers(
      carriersData.map((item) => ({
        ...item,
        status: item.status === 'inactive' ? 'inactive' : 'active',
        key: item.key || item.id,
        maxConnected: Boolean(item.maxConnected),
      })),
    );
  }, [carriersData]);

  const persist = async (next: DeliveryCarrier[]) => {
    setCarriers(next);
    await deliveryCarriersService.bulkReplace(next.map((item) => ({
      id: item.id,
      key: item.id,
      name: item.name,
      company: item.company,
      inn: item.inn,
      phone: item.phone,
      notes: item.notes,
      status: item.status,
      systemUserId: item.systemUserId || null,
      maxCarrierKey: item.maxCarrierKey || null,
    } as DeliveryCarrier)));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['deliveryCarriers'] }),
      queryClient.invalidateQueries({ queryKey: ['delivery-carriers'] }),
      queryClient.invalidateQueries({ queryKey: ['users'] }),
    ]);
  };

  const carrierUsers = React.useMemo(
    () => users.filter((user) => user.role === 'Перевозчик' && user.status === 'Активен'),
    [users],
  );

  const visibleCarriers = React.useMemo(() => {
    if (!showOnlyConnected) return carriers;
    return carriers.filter((carrier) => carrier.maxCarrierKey && connections.some((entry) => entry.key === carrier.maxCarrierKey));
  }, [carriers, connections, showOnlyConnected]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Перевозчики</CardTitle>
            <CardDescription>Отдельный справочник логистических подрядчиков для вкладки «Доставка»</CardDescription>
          </div>
          <Button
            size="sm"
            variant={showOnlyConnected ? 'default' : 'secondary'}
            onClick={() => setShowOnlyConnected((prev) => !prev)}
          >
            {showOnlyConnected ? 'Показать всех' : 'Только MAX'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {visibleCarriers.map((carrier) => {
          const linkedConnection = carrier.maxCarrierKey
            ? connections.find((item) => item.key === carrier.maxCarrierKey)
            : null;
          const linkedSystemUser = carrier.systemUserId
            ? users.find((item) => item.id === carrier.systemUserId)
            : null;
          const isConnected = Boolean(linkedConnection);

          return (
            <div key={carrier.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{carrier.name}</p>
                  {(carrier.company || carrier.inn) && (
                    <p className="text-xs text-gray-500">
                      {carrier.company || 'Без компании'}
                      {carrier.inn ? ` · ИНН ${carrier.inn}` : ''}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={statusVariant(carrier.status)}>{statusLabel(carrier.status)}</Badge>
                    <Badge variant={linkedSystemUser ? 'success' : 'warning'}>
                      {linkedSystemUser ? 'Пользователь привязан' : 'Без пользователя'}
                    </Badge>
                    <Badge variant={isConnected ? 'success' : 'warning'}>
                      {isConnected ? 'MAX подключён' : 'Без MAX'}
                    </Badge>
                  </div>
                  {carrier.phone && <p className="text-xs text-gray-500">{carrier.phone}</p>}
                  {carrier.notes && <p className="text-xs text-gray-500">{carrier.notes}</p>}
                  {linkedSystemUser && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-300">
                      Пользователь: {linkedSystemUser.name}
                      {linkedSystemUser.email ? ` · ${linkedSystemUser.email}` : ''}
                    </p>
                  )}
                  {linkedConnection && (
                    <p className="text-xs text-blue-600 dark:text-blue-300">
                      Привязка MAX: {linkedConnection.name}
                      {linkedConnection.email ? ` · ${linkedConnection.email}` : ''}
                    </p>
                  )}
                </div>
                <div className="w-full max-w-[260px] space-y-2">
                  <select
                    value={carrier.systemUserId || '__none__'}
                    onChange={(e) => {
                      const value = e.target.value === '__none__' ? null : e.target.value;
                      void persist(carriers.map((item) =>
                        item.id === carrier.id
                          ? { ...item, systemUserId: value }
                          : item,
                      ));
                    }}
                    className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  >
                    <option value="__none__">Без пользователя системы</option>
                    {carrierUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}{user.email ? ` · ${user.email}` : ''}
                      </option>
                    ))}
                  </select>
                  <select
                    value={carrier.maxCarrierKey || '__none__'}
                    onChange={(e) => {
                      const value = e.target.value === '__none__' ? null : e.target.value;
                      void persist(carriers.map((item) =>
                        item.id === carrier.id
                          ? { ...item, maxCarrierKey: value, maxConnected: Boolean(value && connections.some((entry) => entry.key === value)) }
                          : item,
                      ));
                    }}
                    className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  >
                    <option value="__none__">Без привязки к MAX</option>
                    {connections.map((connection) => (
                      <option key={connection.key} value={connection.key}>
                        {connection.name}{connection.email ? ` · ${connection.email}` : ''}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void persist(carriers.map((item) => item.id === carrier.id ? { ...item, status: item.status === 'active' ? 'inactive' : 'active' } : item))}
                    >
                      {carrier.status === 'active' ? 'Отключить' : 'Включить'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void persist(carriers.filter((item) => item.id !== carrier.id))}
                    >
                      Удалить
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        <div className="rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-700">
          <p className="mb-2 text-sm font-medium">Добавить перевозчика</p>
          <div className="space-y-2">
            <Input placeholder="Название перевозчика" value={draft.name} onChange={e => setDraft(prev => ({ ...prev, name: e.target.value }))} />
            <Input placeholder="Компания" value={draft.company} onChange={e => setDraft(prev => ({ ...prev, company: e.target.value }))} />
            <Input placeholder="ИНН" value={draft.inn} onChange={e => setDraft(prev => ({ ...prev, inn: e.target.value }))} />
            <Input placeholder="Телефон" value={draft.phone} onChange={e => setDraft(prev => ({ ...prev, phone: e.target.value }))} />
            <Input placeholder="Примечание" value={draft.notes} onChange={e => setDraft(prev => ({ ...prev, notes: e.target.value }))} />
            <select
              value={draft.systemUserId || '__none__'}
              onChange={(e) => setDraft((prev) => ({ ...prev, systemUserId: e.target.value === '__none__' ? '' : e.target.value }))}
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              <option value="__none__">Привязать пользователя позже</option>
              {carrierUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}{user.email ? ` · ${user.email}` : ''}
                </option>
              ))}
            </select>
            <select
              value={draft.maxCarrierKey || '__none__'}
              onChange={(e) => setDraft((prev) => ({ ...prev, maxCarrierKey: e.target.value === '__none__' ? '' : e.target.value }))}
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              <option value="__none__">Привязать позже</option>
              {connections.map((connection) => (
                <option key={connection.key} value={connection.key}>
                  {connection.name}{connection.email ? ` · ${connection.email}` : ''}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={() => {
                if (!draft.name.trim()) return;
                const nextId = `carrier-${Date.now()}`;
                const next: DeliveryCarrier = {
                  id: nextId,
                  key: nextId,
                  name: draft.name.trim(),
                  company: draft.company.trim() || undefined,
                  inn: draft.inn.trim() || undefined,
                  phone: draft.phone.trim() || undefined,
                  notes: draft.notes.trim() || undefined,
                  status: 'active',
                  systemUserId: draft.systemUserId || null,
                  maxCarrierKey: draft.maxCarrierKey || null,
                  maxConnected: Boolean(draft.maxCarrierKey && connections.some((entry) => entry.key === draft.maxCarrierKey)),
                };
                void persist([...carriers, next]);
                setDraft({ name: '', company: '', inn: '', phone: '', notes: '', systemUserId: '', maxCarrierKey: '' });
              }}
            >
              Добавить
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ServiceRouteNormsReferenceList() {
  const queryClient = useQueryClient();
  const { data: routesData = [] } = useQuery<ServiceRouteNorm[]>({
    queryKey: ['serviceRouteNorms'],
    queryFn: serviceRouteNormsService.getAll,
  });
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'active' | 'inactive'>('all');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState('');
  const emptyForm = React.useMemo(() => ({
    from: '',
    to: '',
    distanceKm: '',
    normSpeedKmh: '70',
  }), []);
  const [form, setForm] = React.useState(emptyForm);

  const counts = React.useMemo(() => ({
    total: routesData.length,
    active: routesData.filter(item => item.isActive !== false).length,
    inactive: routesData.filter(item => item.isActive === false).length,
  }), [routesData]);

  const filtered = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return routesData
      .filter(item => {
        const isActive = item.isActive !== false;
        if (statusFilter === 'active' && !isActive) return false;
        if (statusFilter === 'inactive' && isActive) return false;
        return !query || [item.from, item.to, item.distanceKm].join(' ').toLowerCase().includes(query);
      })
      .sort((a, b) => {
        const left = `${a.from} ${a.to}`;
        const right = `${b.from} ${b.to}`;
        return left.localeCompare(right, 'ru');
      });
  }, [routesData, search, statusFilter]);

  const persist = async (next: ServiceRouteNorm[]) => {
    const now = new Date().toISOString();
    const normalized = next.map((item, index) => ({
      ...item,
      id: item.id || `route-${Date.now()}-${index}`,
      from: String(item.from || '').trim(),
      to: String(item.to || '').trim(),
      distanceKm: Math.max(0, Number(item.distanceKm) || 0),
      normSpeedKmh: Math.max(1, Number(item.normSpeedKmh) || 70),
      isActive: item.isActive !== false,
      createdAt: item.createdAt || now,
      updatedAt: now,
    }));
    await serviceRouteNormsService.bulkReplace(normalized);
    await queryClient.invalidateQueries({ queryKey: ['serviceRouteNorms'] });
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError('');
  };

  const openEdit = (item: ServiceRouteNorm) => {
    setEditingId(item.id);
    setForm({
      from: item.from,
      to: item.to,
      distanceKm: String(item.distanceKm),
      normSpeedKmh: String(item.normSpeedKmh || 70),
    });
    setFormError('');
  };

  const submitForm = async () => {
    const from = form.from.trim();
    const to = form.to.trim();
    const distanceKm = Number(form.distanceKm);
    const normSpeedKmh = Number(form.normSpeedKmh);

    if (!from || !to) {
      setFormError('Укажите начальную и конечную точку');
      return;
    }
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
      setFormError('Километраж должен быть больше 0');
      return;
    }
    if (!Number.isFinite(normSpeedKmh) || normSpeedKmh <= 0) {
      setFormError('Нормативная скорость должна быть больше 0');
      return;
    }

    const payload: ServiceRouteNorm = {
      id: editingId || `route-${Date.now()}`,
      from,
      to,
      distanceKm,
      normSpeedKmh,
      isActive: true,
    };

    if (editingId) {
      await persist(routesData.map(item => item.id === editingId ? { ...item, ...payload, isActive: item.isActive !== false } : item));
    } else {
      await persist([...routesData, payload]);
    }

    resetForm();
  };

  const toggleStatus = async (item: ServiceRouteNorm) => {
    await persist(routesData.map(entry => entry.id === item.id ? { ...entry, isActive: !(entry.isActive !== false) } : entry));
  };

  const removeRoute = async (id: string) => {
    await persist(routesData.filter(item => item.id !== id));
    if (editingId === id) resetForm();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <CardTitle>Маршруты выезда</CardTitle>
            <CardDescription>Справочник расстояний для выездных механиков. Закрытие н/ч считается автоматически по формуле км / скорость.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'all', label: 'Все', count: counts.total },
              { id: 'active', label: 'Активные', count: counts.active },
              { id: 'inactive', label: 'Отключенные', count: counts.inactive },
            ].map(filter => (
              <Button
                key={filter.id}
                size="sm"
                variant={statusFilter === filter.id ? 'default' : 'secondary'}
                onClick={() => setStatusFilter(filter.id as 'all' | 'active' | 'inactive')}
              >
                {filter.label}
                <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-[11px] font-semibold text-current dark:bg-white/10">
                  {filter.count}
                </span>
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
          <Input
            placeholder="Поиск по точке отправления, назначения или километражу"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <p className="flex items-center justify-end text-sm text-gray-500">
            Найдено: <span className="ml-1 font-medium text-gray-900 dark:text-white">{filtered.length}</span>
          </p>
        </div>

        <div className="space-y-2">
          {filtered.map(item => {
            const normHours = item.normSpeedKmh > 0 ? (item.distanceKm / item.normSpeedKmh) : 0;
            return (
              <div key={item.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {item.from} → {item.to}
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {item.distanceKm} км · скорость {item.normSpeedKmh} км/ч · закрывается {normHours.toFixed(1)} н/ч
                    </p>
                    <div className="mt-2">
                      <Badge variant={statusVariant(item.isActive !== false ? 'active' : 'inactive')}>
                        {statusLabel(item.isActive !== false ? 'active' : 'inactive')}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => openEdit(item)}>
                      Редактировать
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void toggleStatus(item)}>
                      {item.isActive !== false ? 'Отключить' : 'Включить'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void removeRoute(item.id)}>
                      Удалить
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center dark:border-gray-700">
            <p className="text-sm font-medium text-gray-900 dark:text-white">Маршруты не найдены</p>
            <p className="mt-1 text-sm text-gray-500">Добавьте первый маршрут или измените поиск.</p>
          </div>
        )}

        <div className="rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-700">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{editingId ? 'Редактировать маршрут' : 'Добавить маршрут'}</p>
              <p className="text-xs text-gray-500">Этот справочник будет использоваться ботом при оформлении выезда.</p>
            </div>
            {editingId && (
              <Button size="sm" variant="ghost" onClick={resetForm}>
                Отменить редактирование
              </Button>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Input placeholder="Откуда" value={form.from} onChange={e => setForm(prev => ({ ...prev, from: e.target.value }))} />
            <Input placeholder="Куда" value={form.to} onChange={e => setForm(prev => ({ ...prev, to: e.target.value }))} />
            <Input
              type="number"
              min="1"
              step="1"
              placeholder="Километраж"
              value={form.distanceKm}
              onChange={e => setForm(prev => ({ ...prev, distanceKm: e.target.value }))}
            />
            <Input
              type="number"
              min="1"
              step="1"
              placeholder="Нормативная скорость, км/ч"
              value={form.normSpeedKmh}
              onChange={e => setForm(prev => ({ ...prev, normSpeedKmh: e.target.value }))}
            />
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Нормо-часы по маршруту: {((Number(form.distanceKm) || 0) / Math.max(1, Number(form.normSpeedKmh) || 70)).toFixed(1)} н/ч
          </p>
          {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => void submitForm()}>
              {editingId ? 'Сохранить маршрут' : 'Добавить маршрут'}
            </Button>
            <Button size="sm" variant="secondary" onClick={resetForm}>
              Очистить
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ServiceWorkCatalogReferenceList() {
  const queryClient = useQueryClient();
  const { data: worksData = [] } = useQuery<ServiceWork[]>({
    queryKey: ['serviceWorks'],
    queryFn: serviceWorksService.getAll,
  });
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'active' | 'inactive'>('all');
  const [categoryFilter, setCategoryFilter] = React.useState('all');
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [sheetMode, setSheetMode] = React.useState<'create' | 'edit'>('create');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [bulkCategory, setBulkCategory] = React.useState('');
  const [formError, setFormError] = React.useState('');
  const emptyForm = React.useMemo(() => ({
    name: '',
    category: '',
    description: '',
    normHours: '',
    ratePerHour: '',
    sortOrder: '0',
  }), []);
  const [form, setForm] = React.useState(emptyForm);

  const categories = React.useMemo(
    () => [...new Set(worksData.map(item => item.category?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'ru')),
    [worksData],
  );

  const counts = React.useMemo(() => ({
    total: worksData.length,
    active: worksData.filter(item => item.isActive).length,
    inactive: worksData.filter(item => !item.isActive).length,
  }), [worksData]);

  const filtered = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return worksData
      .filter(item => {
        if (statusFilter === 'active' && !item.isActive) return false;
        if (statusFilter === 'inactive' && item.isActive) return false;
        if (categoryFilter !== 'all' && (item.category || '') !== categoryFilter) return false;
        return !query || [item.name, item.category, item.description].filter(Boolean).join(' ').toLowerCase().includes(query);
      })
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name, 'ru');
      });
  }, [categoryFilter, search, statusFilter, worksData]);
  const allFilteredSelected = filtered.length > 0 && filtered.every(item => selectedIds.includes(item.id));
  const selectedCount = selectedIds.length;

  const reload = async () => {
    await queryClient.invalidateQueries({ queryKey: ['serviceWorks'] });
    await queryClient.invalidateQueries({ queryKey: ['serviceWorks', 'active'] });
  };

  const openCreate = () => {
    setSheetMode('create');
    setSelectedId(null);
    setForm(emptyForm);
    setFormError('');
    setSheetOpen(true);
  };

  const openEdit = (item: ServiceWork) => {
    setSheetMode('edit');
    setSelectedId(item.id);
    setForm({
      name: item.name,
      category: item.category || '',
      description: item.description || '',
      normHours: String(item.normHours),
      ratePerHour: item.ratePerHour ? String(item.ratePerHour) : '',
      sortOrder: String(item.sortOrder),
    });
    setFormError('');
    setSheetOpen(true);
  };

  const submitForm = async () => {
    const normHours = Number(form.normHours);
    const ratePerHour = Number(form.ratePerHour) || 0;
    const sortOrder = Number(form.sortOrder);
    if (!form.name.trim()) {
      setFormError('Введите название работы');
      return;
    }
    if (!Number.isFinite(normHours) || normHours < 0) {
      setFormError('Нормо-часы должны быть числом 0 или больше');
      return;
    }
    const payload = {
      name: form.name.trim(),
      category: form.category.trim() || undefined,
      description: form.description.trim() || undefined,
      normHours,
      ratePerHour: Math.max(0, ratePerHour),
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    };
    if (sheetMode === 'create') {
      await serviceWorksService.create({
        ...payload,
        isActive: true,
      });
    } else if (selectedId) {
      await serviceWorksService.update(selectedId, payload);
    }
    setSheetOpen(false);
    setForm(emptyForm);
    await reload();
  };

  const toggleStatus = async (item: ServiceWork) => {
    await serviceWorksService.update(item.id, { isActive: !item.isActive });
    await reload();
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds(prev => checked ? [...new Set([...prev, id])] : prev.filter(item => item !== id));
  };

  const toggleSelectAllFiltered = (checked: boolean) => {
    if (checked) {
      setSelectedIds(prev => [...new Set([...prev, ...filtered.map(item => item.id)])]);
      return;
    }
    const filteredIds = new Set(filtered.map(item => item.id));
    setSelectedIds(prev => prev.filter(id => !filteredIds.has(id)));
  };

  const runBulkUpdate = async (changes: Partial<ServiceWork>) => {
    if (selectedIds.length === 0) return;
    const ids = [...selectedIds];
    await Promise.all(ids.map(id => serviceWorksService.update(id, changes)));
    setSelectedIds([]);
    setBulkCategory('');
    await reload();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <CardTitle>Работы</CardTitle>
            <CardDescription>Каталог работ с нормо-часами для ремонтов и аналитики механиков</CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Добавить работу
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px]">
          <Input placeholder="Поиск по названию, категории или описанию" value={search} onChange={e => setSearch(e.target.value)} />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Все категории" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все категории</SelectItem>
              {categories.map(category => (
                <SelectItem key={category} value={category}>{category}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'all', label: 'Все', count: counts.total },
              { id: 'active', label: 'Активные', count: counts.active },
              { id: 'inactive', label: 'Отключенные', count: counts.inactive },
            ].map(filter => (
              <Button
                key={filter.id}
                size="sm"
                variant={statusFilter === filter.id ? 'default' : 'secondary'}
                onClick={() => setStatusFilter(filter.id as 'all' | 'active' | 'inactive')}
              >
                {filter.label}
                <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-[11px] font-semibold text-current dark:bg-white/10">
                  {filter.count}
                </span>
              </Button>
            ))}
          </div>
          <p className="text-sm text-gray-500 lg:text-right">
            Найдено: <span className="font-medium text-gray-900 dark:text-white">{filtered.length}</span>
          </p>
        </div>

        {selectedCount > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900/40 xl:flex-row xl:items-center xl:justify-between">
            <p className="text-sm leading-none">
              Выбрано работ: <span className="font-semibold">{selectedCount}</span>
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Button size="sm" variant="secondary" onClick={() => void runBulkUpdate({ isActive: true })}>
                Включить
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void runBulkUpdate({ isActive: false })}>
                Отключить
              </Button>
              <Input
                className="sm:w-[220px]"
                placeholder="Новая категория"
                value={bulkCategory}
                onChange={e => setBulkCategory(e.target.value)}
              />
              <Button
                size="sm"
                onClick={() => void runBulkUpdate({ category: bulkCategory.trim() || undefined })}
              >
                Сменить категорию
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setSelectedIds([]); setBulkCategory(''); }}>
                Сбросить выбор
              </Button>
            </div>
          </div>
        )}

        <div className="hidden max-h-[620px] overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 lg:block">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-white dark:bg-gray-800">
              <TableRow>
                <TableHead className="w-[48px]">
                  <input
                    type="checkbox"
                    aria-label="Выбрать все работы"
                    checked={allFilteredSelected}
                    onChange={e => toggleSelectAllFiltered(e.target.checked)}
                  />
                </TableHead>
                <TableHead>Работа</TableHead>
                <TableHead>Категория</TableHead>
                <TableHead className="w-[120px]">Нормо-часы</TableHead>
                <TableHead className="w-[150px]">Ставка</TableHead>
                <TableHead className="w-[110px]">Порядок</TableHead>
                <TableHead className="w-[120px]">Статус</TableHead>
                <TableHead className="w-[180px] text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(item => (
                <TableRow
                  key={item.id}
                  className="cursor-pointer align-top"
                  onClick={() => openEdit(item)}
                >
                  <TableCell className="py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Выбрать работу ${item.name}`}
                      checked={selectedIds.includes(item.id)}
                      onClick={event => event.stopPropagation()}
                      onChange={e => toggleSelected(item.id, e.target.checked)}
                    />
                  </TableCell>
                  <TableCell className="py-2.5">
                    <div className="space-y-1">
                      <p className="font-medium leading-snug">{item.name}</p>
                      {item.description && (
                        <p className="line-clamp-1 text-xs text-gray-500">{item.description}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-2.5">{item.category || 'Без категории'}</TableCell>
                  <TableCell className="py-2.5 whitespace-nowrap">{item.normHours} н/ч</TableCell>
                  <TableCell className="py-2.5 whitespace-nowrap">
                    {item.ratePerHour > 0 ? `${item.ratePerHour.toLocaleString('ru-RU')} ₽/н·ч` : 'Не задана'}
                  </TableCell>
                  <TableCell className="py-2.5">{item.sortOrder}</TableCell>
                  <TableCell className="py-2.5">
                    <Badge variant={statusVariant(item.isActive ? 'active' : 'inactive')}>
                      {statusLabel(item.isActive ? 'active' : 'inactive')}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2.5">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(item);
                        }}
                      >
                        Редактировать
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleStatus(item);
                        }}
                      >
                        {item.isActive ? 'Отключить' : 'Включить'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-2 lg:hidden lg:max-h-none max-h-[70vh] overflow-auto pr-1">
          {filtered.map(item => (
            <div
              key={item.id}
              className="rounded-xl border border-gray-200 p-2.5 dark:border-gray-700"
              onClick={() => openEdit(item)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Выбрать работу ${item.name}`}
                    className="mt-1"
                    checked={selectedIds.includes(item.id)}
                    onClick={event => event.stopPropagation()}
                    onChange={e => toggleSelected(item.id, e.target.checked)}
                  />
                  <div>
                    <p className="text-sm font-medium leading-snug">{item.name}</p>
                    <p className="text-xs text-gray-500">
                      {item.category || 'Без категории'} · {item.normHours} н/ч
                      {item.ratePerHour > 0 ? ` · ${item.ratePerHour.toLocaleString('ru-RU')} ₽/н·ч` : ''}
                    </p>
                    {item.description && <p className="mt-1 line-clamp-2 text-xs text-gray-500">{item.description}</p>}
                  </div>
                </div>
                <Badge variant={statusVariant(item.isActive ? 'active' : 'inactive')}>
                  {statusLabel(item.isActive ? 'active' : 'inactive')}
                </Badge>
              </div>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => openEdit(item)}>
                  Редактировать
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void toggleStatus(item)}>
                  {item.isActive ? 'Отключить' : 'Включить'}
                </Button>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center dark:border-gray-700">
            <p className="text-sm font-medium text-gray-900 dark:text-white">Работы не найдены</p>
            <p className="mt-1 text-sm text-gray-500">Измени поиск или фильтры, либо добавь новую работу в каталог.</p>
          </div>
        )}
      </CardContent>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader className="border-b border-gray-200 pb-4 dark:border-gray-800">
            <SheetTitle>{sheetMode === 'create' ? 'Новая работа' : 'Редактирование работы'}</SheetTitle>
            <SheetDescription>
              Карточка открывается отдельно, чтобы каталог оставался компактным даже при сотнях записей.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <Field label="Название работы">
              <Input value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Например: Замена гидронасоса" />
            </Field>
            <Field label="Категория">
              <Input value={form.category} onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))} placeholder="Например: Гидравлика" />
            </Field>
            <Field label="Описание">
              <Input value={form.description} onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} placeholder="Кратко опиши состав работ" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Нормо-часы">
                <Input type="number" min="0" step="0.1" value={form.normHours} onChange={e => setForm(prev => ({ ...prev, normHours: e.target.value }))} placeholder="0.8" />
              </Field>
              <Field label="Ставка ₽/н·ч">
                <Input type="number" min="0" step="100" value={form.ratePerHour} onChange={e => setForm(prev => ({ ...prev, ratePerHour: e.target.value }))} placeholder="2500" />
              </Field>
              <Field label="Порядок">
                <Input type="number" min="0" step="1" value={form.sortOrder} onChange={e => setForm(prev => ({ ...prev, sortOrder: e.target.value }))} placeholder="0" />
              </Field>
            </div>
            {sheetMode === 'edit' && selectedId && (
              <div className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">Статус записи</p>
                    <p className="text-gray-500">Работу можно временно скрыть из справочника, не удаляя её.</p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const current = worksData.find(item => item.id === selectedId);
                      if (!current) return;
                      void toggleStatus(current);
                    }}
                  >
                    {(worksData.find(item => item.id === selectedId)?.isActive ?? true) ? 'Отключить' : 'Включить'}
                  </Button>
                </div>
              </div>
            )}
            {formError && <p className="text-sm text-red-600">{formError}</p>}
          </div>
          <SheetFooter className="border-t border-gray-200 pt-4 dark:border-gray-800">
            <Button variant="secondary" onClick={() => setSheetOpen(false)}>Отмена</Button>
            <Button onClick={() => void submitForm()}>{sheetMode === 'create' ? 'Добавить' : 'Сохранить'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </Card>
  );
}

function SparePartsReferenceList() {
  const queryClient = useQueryClient();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const { data: partsData = [] } = useQuery<SparePart[]>({
    queryKey: ['spareParts'],
    queryFn: sparePartsService.getAll,
  });
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'active' | 'inactive'>('all');
  const [categoryFilter, setCategoryFilter] = React.useState('all');
  const [manufacturerFilter, setManufacturerFilter] = React.useState('all');
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [sheetMode, setSheetMode] = React.useState<'create' | 'edit'>('create');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [bulkCategory, setBulkCategory] = React.useState('');
  const [formError, setFormError] = React.useState('');
  const [importMessage, setImportMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const emptyForm = React.useMemo(() => ({
    name: '',
    article: '',
    unit: 'шт',
    defaultPrice: '',
    category: '',
    manufacturer: '',
  }), []);
  const [form, setForm] = React.useState(emptyForm);

  const categories = React.useMemo(
    () => [...new Set(partsData.map(item => item.category?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'ru')),
    [partsData],
  );
  const manufacturers = React.useMemo(
    () => [...new Set(partsData.map(item => item.manufacturer?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'ru')),
    [partsData],
  );
  const counts = React.useMemo(() => ({
    total: partsData.length,
    active: partsData.filter(item => item.isActive).length,
    inactive: partsData.filter(item => !item.isActive).length,
  }), [partsData]);

  const filtered = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return partsData
      .filter(item => {
        if (statusFilter === 'active' && !item.isActive) return false;
        if (statusFilter === 'inactive' && item.isActive) return false;
        if (categoryFilter !== 'all' && (item.category || '') !== categoryFilter) return false;
        if (manufacturerFilter !== 'all' && (item.manufacturer || '') !== manufacturerFilter) return false;
        return !query || [item.name, item.article, item.category, item.manufacturer].filter(Boolean).join(' ').toLowerCase().includes(query);
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [categoryFilter, manufacturerFilter, partsData, search, statusFilter]);
  const allFilteredSelected = filtered.length > 0 && filtered.every(item => selectedIds.includes(item.id));
  const selectedCount = selectedIds.length;

  const reload = async () => {
    await queryClient.invalidateQueries({ queryKey: ['spareParts'] });
    await queryClient.invalidateQueries({ queryKey: ['spareParts', 'active'] });
  };

  const openCreate = () => {
    setSheetMode('create');
    setSelectedId(null);
    setForm(emptyForm);
    setFormError('');
    setSheetOpen(true);
  };

  const openEdit = (item: SparePart) => {
    setSheetMode('edit');
    setSelectedId(item.id);
    setForm({
      name: item.name,
      article: item.article || '',
      unit: item.unit,
      defaultPrice: String(item.defaultPrice),
      category: item.category || '',
      manufacturer: item.manufacturer || '',
    });
    setFormError('');
    setSheetOpen(true);
  };

  const submitForm = async () => {
    const defaultPrice = Number(form.defaultPrice);
    if (!form.name.trim()) {
      setFormError('Введите название запчасти');
      return;
    }
    if (!form.unit.trim()) {
      setFormError('Укажите единицу измерения');
      return;
    }
    if (!Number.isFinite(defaultPrice) || defaultPrice < 0) {
      setFormError('Базовая цена должна быть числом 0 или больше');
      return;
    }
    const payload = {
      name: form.name.trim(),
      article: form.article.trim() || undefined,
      sku: form.article.trim() || undefined,
      unit: form.unit.trim(),
      defaultPrice,
      category: form.category.trim() || undefined,
      manufacturer: form.manufacturer.trim() || undefined,
    };
    if (sheetMode === 'create') {
      await sparePartsService.create({
        ...payload,
        isActive: true,
      });
    } else if (selectedId) {
      await sparePartsService.update(selectedId, payload);
    }
    setSheetOpen(false);
    setForm(emptyForm);
    await reload();
  };

  const toggleStatus = async (item: SparePart) => {
    await sparePartsService.update(item.id, { isActive: !item.isActive });
    await reload();
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds(prev => checked ? [...new Set([...prev, id])] : prev.filter(item => item !== id));
  };

  const toggleSelectAllFiltered = (checked: boolean) => {
    if (checked) {
      setSelectedIds(prev => [...new Set([...prev, ...filtered.map(item => item.id)])]);
      return;
    }
    const filteredIds = new Set(filtered.map(item => item.id));
    setSelectedIds(prev => prev.filter(id => !filteredIds.has(id)));
  };

  const runBulkUpdate = async (changes: Partial<SparePart>) => {
    if (selectedIds.length === 0) return;
    const ids = [...selectedIds];
    await Promise.all(ids.map(id => sparePartsService.update(id, changes)));
    setSelectedIds([]);
    setBulkCategory('');
    await reload();
  };

  const downloadCsv = (csv: string, filename: string) => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportParts = () => {
    downloadCsv(sparePartsToCsv(partsData), `spare-parts-${new Date().toISOString().slice(0, 10)}.csv`);
    setImportMessage({ type: 'success', text: `Выгружено запчастей: ${partsData.length}` });
  };

  const downloadTemplate = () => {
    downloadCsv(sparePartsToCsv([]), 'spare-parts-template.csv');
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setImportMessage({ type: 'error', text: 'Поддерживается импорт CSV. XLSX можно сохранить как CSV и загрузить повторно.' });
      return;
    }
    try {
      const text = await file.text();
      const plan = buildSparePartsImportPlan(partsData, text);
      if (plan.stats.errors > 0) {
        setImportMessage({
          type: 'error',
          text: [`Импорт остановлен: ошибок ${plan.stats.errors}.`, ...plan.errors.slice(0, 3)].join(' '),
        });
        return;
      }
      await sparePartsService.bulkReplace(plan.parts as SparePart[]);
      await reload();
      setSelectedIds([]);
      setImportMessage({
        type: 'success',
        text: `Импорт завершён: добавлено ${plan.stats.added}, обновлено ${plan.stats.updated}, пропущено ${plan.stats.skipped}, ошибок ${plan.stats.errors}.`,
      });
    } catch (error) {
      setImportMessage({ type: 'error', text: error instanceof Error ? error.message : 'Не удалось импортировать запчасти' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <CardTitle>Запчасти</CardTitle>
            <CardDescription>Каталог запчастей для ремонтов с хранением артикула, единицы и базовой цены</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={exportParts}>
              <Download className="h-4 w-4" />
              Выгрузить запчасти
            </Button>
            <Button size="sm" variant="secondary" onClick={downloadTemplate}>
              <Download className="h-4 w-4" />
              Скачать шаблон
            </Button>
            <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              Загрузить запчасти
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Добавить запчасть
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".csv,text/csv"
          onChange={event => void handleImportFile(event)}
        />
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
          Можно загрузить CSV со списком запчастей. Дубли по артикулу будут обновлены; если артикула нет, совпадение ищется по наименованию.
        </div>
        {importMessage && (
          <div className={`rounded-lg border px-3 py-2 text-sm ${
            importMessage.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-200'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200'
          }`}>
            {importMessage.text}
          </div>
        )}
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px_220px]">
          <Input placeholder="Поиск по названию, артикулу, категории или производителю" value={search} onChange={e => setSearch(e.target.value)} />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Все категории" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все категории</SelectItem>
              {categories.map(category => (
                <SelectItem key={category} value={category}>{category}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={manufacturerFilter} onValueChange={setManufacturerFilter}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Все производители" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все производители</SelectItem>
              {manufacturers.map(manufacturer => (
                <SelectItem key={manufacturer} value={manufacturer}>{manufacturer}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'all', label: 'Все', count: counts.total },
              { id: 'active', label: 'Активные', count: counts.active },
              { id: 'inactive', label: 'Отключенные', count: counts.inactive },
            ].map(filter => (
              <Button
                key={filter.id}
                size="sm"
                variant={statusFilter === filter.id ? 'default' : 'secondary'}
                onClick={() => setStatusFilter(filter.id as 'all' | 'active' | 'inactive')}
              >
                {filter.label}
                <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-[11px] font-semibold text-current dark:bg-white/10">
                  {filter.count}
                </span>
              </Button>
            ))}
          </div>
          <p className="text-sm text-gray-500 lg:text-right">
            Найдено: <span className="font-medium text-gray-900 dark:text-white">{filtered.length}</span>
          </p>
        </div>

        {selectedCount > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900/40 xl:flex-row xl:items-center xl:justify-between">
            <p className="text-sm leading-none">
              Выбрано запчастей: <span className="font-semibold">{selectedCount}</span>
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Button size="sm" variant="secondary" onClick={() => void runBulkUpdate({ isActive: true })}>
                Включить
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void runBulkUpdate({ isActive: false })}>
                Отключить
              </Button>
              <Input
                className="sm:w-[220px]"
                placeholder="Новая категория"
                value={bulkCategory}
                onChange={e => setBulkCategory(e.target.value)}
              />
              <Button
                size="sm"
                onClick={() => void runBulkUpdate({ category: bulkCategory.trim() || undefined })}
              >
                Сменить категорию
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setSelectedIds([]); setBulkCategory(''); }}>
                Сбросить выбор
              </Button>
            </div>
          </div>
        )}

        <div className="hidden max-h-[620px] overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 lg:block">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-white dark:bg-gray-800">
              <TableRow>
                <TableHead className="w-[48px]">
                  <input
                    type="checkbox"
                    aria-label="Выбрать все запчасти"
                    checked={allFilteredSelected}
                    onChange={e => toggleSelectAllFiltered(e.target.checked)}
                  />
                </TableHead>
                <TableHead>Запчасть</TableHead>
                <TableHead>Артикул</TableHead>
                <TableHead>Категория</TableHead>
                <TableHead>Производитель</TableHead>
                <TableHead className="w-[130px]">Цена</TableHead>
                <TableHead className="w-[110px]">Статус</TableHead>
                <TableHead className="w-[180px] text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(item => (
                <TableRow
                  key={item.id}
                  className="cursor-pointer align-top"
                  onClick={() => openEdit(item)}
                >
                  <TableCell className="py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Выбрать запчасть ${item.name}`}
                      checked={selectedIds.includes(item.id)}
                      onClick={event => event.stopPropagation()}
                      onChange={e => toggleSelected(item.id, e.target.checked)}
                    />
                  </TableCell>
                  <TableCell className="py-2.5">
                    <div className="space-y-1">
                      <p className="font-medium leading-snug">{item.name}</p>
                      <p className="text-xs text-gray-500">{item.unit}</p>
                    </div>
                  </TableCell>
                  <TableCell className="py-2.5">{item.article || 'Без артикула'}</TableCell>
                  <TableCell className="py-2.5">{item.category || 'Без категории'}</TableCell>
                  <TableCell className="py-2.5">{item.manufacturer || 'Не указан'}</TableCell>
                  <TableCell className="py-2.5 whitespace-nowrap">{`${item.defaultPrice.toLocaleString('ru-RU')} ₽/${item.unit}`}</TableCell>
                  <TableCell className="py-2.5">
                    <Badge variant={statusVariant(item.isActive ? 'active' : 'inactive')}>
                      {statusLabel(item.isActive ? 'active' : 'inactive')}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2.5">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(item);
                        }}
                      >
                        Редактировать
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleStatus(item);
                        }}
                      >
                        {item.isActive ? 'Отключить' : 'Включить'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-2 lg:hidden lg:max-h-none max-h-[70vh] overflow-auto pr-1">
          {filtered.map(item => (
            <div
              key={item.id}
              className="rounded-xl border border-gray-200 p-2.5 dark:border-gray-700"
              onClick={() => openEdit(item)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Выбрать запчасть ${item.name}`}
                    className="mt-1"
                    checked={selectedIds.includes(item.id)}
                    onClick={event => event.stopPropagation()}
                    onChange={e => toggleSelected(item.id, e.target.checked)}
                  />
                  <div>
                    <p className="text-sm font-medium leading-snug">{item.name}</p>
                    <p className="text-xs text-gray-500">
                      {item.article || 'Без артикула'} · {item.defaultPrice.toLocaleString('ru-RU')} ₽/{item.unit}
                    </p>
                    {(item.category || item.manufacturer) && (
                      <p className="mt-1 line-clamp-2 text-xs text-gray-500">{[item.category, item.manufacturer].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                </div>
                <Badge variant={statusVariant(item.isActive ? 'active' : 'inactive')}>
                  {statusLabel(item.isActive ? 'active' : 'inactive')}
                </Badge>
              </div>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => openEdit(item)}>
                  Редактировать
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void toggleStatus(item)}>
                  {item.isActive ? 'Отключить' : 'Включить'}
                </Button>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center dark:border-gray-700">
            <p className="text-sm font-medium text-gray-900 dark:text-white">Запчасти не найдены</p>
            <p className="mt-1 text-sm text-gray-500">Измени поиск или фильтры, либо добавь новую позицию в каталог.</p>
          </div>
        )}
      </CardContent>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader className="border-b border-gray-200 pb-4 dark:border-gray-800">
            <SheetTitle>{sheetMode === 'create' ? 'Новая запчасть' : 'Редактирование запчасти'}</SheetTitle>
            <SheetDescription>
              Добавление и редактирование вынесены в отдельную панель, чтобы каталог не превращался в длинную форму.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <Field label="Название запчасти">
              <Input value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Например: Гидравлический насос" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Артикул">
                <Input value={form.article} onChange={e => setForm(prev => ({ ...prev, article: e.target.value }))} placeholder="SKU / артикул" />
              </Field>
              <Field label="Единица измерения">
                <Input value={form.unit} onChange={e => setForm(prev => ({ ...prev, unit: e.target.value }))} placeholder="шт" />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Базовая цена">
                <Input type="number" min="0" value={form.defaultPrice} onChange={e => setForm(prev => ({ ...prev, defaultPrice: e.target.value }))} placeholder="0" />
              </Field>
              <Field label="Категория">
                <Input value={form.category} onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))} placeholder="Например: Гидравлика" />
              </Field>
              <Field label="Производитель">
                <Input value={form.manufacturer} onChange={e => setForm(prev => ({ ...prev, manufacturer: e.target.value }))} placeholder="Parker" />
              </Field>
            </div>
            {sheetMode === 'edit' && selectedId && (
              <div className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">Статус записи</p>
                    <p className="text-gray-500">Запчасть можно отключить, чтобы скрыть её из активного каталога.</p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const current = partsData.find(item => item.id === selectedId);
                      if (!current) return;
                      void toggleStatus(current);
                    }}
                  >
                    {(partsData.find(item => item.id === selectedId)?.isActive ?? true) ? 'Отключить' : 'Включить'}
                  </Button>
                </div>
              </div>
            )}
            {formError && <p className="text-sm text-red-600">{formError}</p>}
          </div>
          <SheetFooter className="border-t border-gray-200 pt-4 dark:border-gray-800">
            <Button variant="secondary" onClick={() => setSheetOpen(false)}>Отмена</Button>
            <Button onClick={() => void submitForm()}>{sheetMode === 'create' ? 'Добавить' : 'Сохранить'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
