import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import * as Tabs from '@radix-ui/react-tabs';
import { Plus, Trash2, Edit, Eye, EyeOff, AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert } from 'lucide-react';
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
import { Input } from '../components/ui/input';
import {
  loadOwners, saveOwners, type Owner,
  loadEquipment, saveEquipment,
  loadGanttRentals, saveGanttRentals,
  loadServiceTickets, saveServiceTickets,
  loadClients, saveClients,
  loadPayments, savePayments,
  loadDocuments, saveDocuments,
  loadShippingPhotos, saveShippingPhotos,
  RENTALS_STORAGE_KEY,
} from '../mock-data';

// ── Типы ─────────────────────────────────────────────────────────────────────

export type UserRole = 'Администратор' | 'Менеджер по аренде' | 'Механик' | 'Офис-менеджер';
export type UserStatus = 'Активен' | 'Неактивен';

export interface SystemUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  password: string; // хранится в открытом виде (нет бэкенда)
}

const ROLES: UserRole[] = ['Администратор', 'Менеджер по аренде', 'Механик', 'Офис-менеджер'];

// ── localStorage ──────────────────────────────────────────────────────────────

export const USERS_STORAGE_KEY = 'app_system_users';

export function loadUsers(): SystemUser[] {
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as SystemUser[];
  } catch { /* ignore */ }
  return getDefaultUsers();
}

function saveUsers(users: SystemUser[]) {
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
}

function getDefaultUsers(): SystemUser[] {
  return [
    { id: '0', name: 'Администратор',                email: 'hrrkzn@yandex.ru',    role: 'Администратор',      status: 'Активен',   password: 'kazan2013' },
    { id: '5', name: 'mp2',                          email: 'mp2@mantall.ru',       role: 'Менеджер по аренде', status: 'Активен',   password: '1234' },
    { id: '1', name: 'Смирнова Анна Петровна',      email: 'smirnova@company.ru', role: 'Менеджер по аренде', status: 'Активен',   password: '1234' },
    { id: '2', name: 'Козлов Дмитрий Владимирович',  email: 'kozlov@company.ru',   role: 'Менеджер по аренде', status: 'Активен',   password: '1234' },
    { id: '3', name: 'Петров Иван Сергеевич',        email: 'petrov@company.ru',   role: 'Механик',            status: 'Активен',   password: '1234' },
  ];
}

// ── Вспомогательные ───────────────────────────────────────────────────────────

type BadgeVariant = 'danger' | 'warning' | 'info' | 'success' | 'secondary';

function roleBadgeVariant(role: UserRole): BadgeVariant {
  if (role === 'Администратор') return 'danger';
  if (role === 'Механик') return 'warning';
  return 'info';
}

const EMPTY_FORM = { name: '', email: '', role: 'Менеджер по аренде' as UserRole, status: 'Активен' as UserStatus, password: '' };

// ── Основной компонент ────────────────────────────────────────────────────────

export default function Settings() {
  const [users, setUsersState] = React.useState<SystemUser[]>(loadUsers);

  // Синхронизируем с localStorage при каждом изменении
  const setUsers = React.useCallback((updater: (prev: SystemUser[]) => SystemUser[]) => {
    setUsersState(prev => {
      const next = updater(prev);
      saveUsers(next);
      return next;
    });
  }, []);

  // ── Диалог ──────────────────────────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [showPassword, setShowPassword] = React.useState(false);
  const [formError, setFormError] = React.useState('');

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowPassword(false);
    setFormError('');
    setDialogOpen(true);
  };

  const openEdit = (user: SystemUser) => {
    setEditingId(user.id);
    setForm({ name: user.name, email: user.email, role: user.role, status: user.status, password: '' });
    setShowPassword(false);
    setFormError('');
    setDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    setUsers(prev => prev.filter(u => u.id !== id));
  };

  const handleSave = () => {
    if (!form.name.trim())  { setFormError('Введите имя'); return; }
    if (!form.email.trim()) { setFormError('Введите email'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { setFormError('Некорректный email'); return; }

    // Проверка дублирующего email (при добавлении или смене email)
    const duplicate = users.find(u => u.email.toLowerCase() === form.email.toLowerCase() && u.id !== editingId);
    if (duplicate) { setFormError('Пользователь с таким email уже существует'); return; }

    if (editingId) {
      // При редактировании: пустой пароль = не меняем
      setUsers(prev => prev.map(u => {
        if (u.id !== editingId) return u;
        return { ...u, name: form.name, email: form.email, role: form.role, status: form.status, ...(form.password ? { password: form.password } : {}) };
      }));
    } else {
      if (!form.password.trim()) { setFormError('Задайте пароль для нового пользователя'); return; }
      const newUser: SystemUser = { id: Date.now().toString(), ...form };
      setUsers(prev => [...prev, newUser]);
    }
    setDialogOpen(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl text-gray-900 dark:text-white">Настройки</h1>
        <p className="mt-1 text-sm text-gray-500">Конфигурация системы и справочники</p>
      </div>

      <Tabs.Root defaultValue="users" className="space-y-6">
        <Tabs.List className="flex gap-4 border-b border-gray-200 dark:border-gray-700">
          {[
            { value: 'users',         label: 'Пользователи и роли' },
            { value: 'reference',     label: 'Справочники' },
            { value: 'notifications', label: 'Уведомления' },
            { value: 'data',          label: 'Данные системы' },
          ].map(tab => (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              className="border-b-2 border-transparent px-4 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 data-[state=active]:border-[--color-primary] data-[state=active]:text-[--color-primary]"
            >
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* ── Пользователи ─────────────────────────────────────────────────── */}
        <Tabs.Content value="users">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Пользователи системы</CardTitle>
                  <CardDescription>Управление доступом сотрудников. Вход — по email и паролю.</CardDescription>
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
                      <TableHead>Email (логин)</TableHead>
                      <TableHead>Роль</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead className="w-[90px]">Действия</TableHead>
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
                          <div className="flex gap-2">
                            <button
                              onClick={() => openEdit(user)}
                              className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                              title="Редактировать"
                            >
                              <Edit className="h-4 w-4 text-gray-500" />
                            </button>
                            <button
                              onClick={() => handleDelete(user.id)}
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
        </Tabs.Content>

        {/* ── Справочники ──────────────────────────────────────────────────── */}
        <Tabs.Content value="reference">
          <div className="grid gap-6 lg:grid-cols-2">
            <ReferenceList title="Типы техники"    items={['Ножничный', 'Коленчатый', 'Телескопический', 'Мачтовый']} />
            <ReferenceList title="Локации"         items={['Москва, склад А', 'Москва, склад Б', 'Санкт-Петербург']} />
            <StatusList />
            <ReferenceList title="Причины простоя" items={['Плановое ТО', 'Ремонт', 'Ожидание запчастей', 'Калибровка']} />
            <OwnersReferenceList />
          </div>
        </Tabs.Content>

        {/* ── Уведомления ──────────────────────────────────────────────────── */}
        <Tabs.Content value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Правила уведомлений</CardTitle>
              <CardDescription>Настройка email и Telegram уведомлений</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                {[
                  { title: 'Просроченные возвраты',      desc: 'Уведомление при просрочке возврата техники',  channels: ['Email', 'Telegram'] },
                  { title: 'Критические заявки сервиса', desc: 'Уведомление о новых критических заявках',      channels: ['Email', 'Telegram'] },
                  { title: 'Предстоящее ТО',             desc: 'Напоминание за 7 дней до ТО',                 channels: ['Email'] },
                  { title: 'Просроченные платежи',       desc: 'Уведомление о просроченных счетах',           channels: ['Email'] },
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
        </Tabs.Content>

        {/* ── Данные системы ────────────────────────────────────────────────── */}
        <Tabs.Content value="data">
          <DataResetSection />
        </Tabs.Content>
      </Tabs.Root>

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
            <Field label="Email (используется для входа)">
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="ivanov@company.ru"
                className={fieldClass}
              />
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

// ── Сброс тестовых данных ─────────────────────────────────────────────────────

interface DataCounts {
  ganttRentals: number;
  classicRentals: number;
  serviceTickets: number;
  clients: number;
  payments: number;
  documents: number;
  shippingPhotos: number;
  equipment: number;
}

function getDataCounts(): DataCounts {
  const classicRaw = localStorage.getItem(RENTALS_STORAGE_KEY);
  const classicList = classicRaw ? (() => { try { return JSON.parse(classicRaw); } catch { return []; } })() : [];
  return {
    ganttRentals:  loadGanttRentals().length,
    classicRentals: classicList.length,
    serviceTickets: loadServiceTickets().length,
    clients:        loadClients().length,
    payments:       loadPayments().length,
    documents:      loadDocuments().length,
    shippingPhotos: loadShippingPhotos().length,
    equipment:      loadEquipment().length,
  };
}

function DataResetSection() {
  const [counts, setCounts]           = React.useState<DataCounts>(getDataCounts);
  const [dialogOpen, setDialogOpen]   = React.useState(false);
  const [confirmText, setConfirmText] = React.useState('');
  const [done, setDone]               = React.useState(false);
  const [resetting, setResetting]     = React.useState(false);

  const totalToDelete =
    counts.ganttRentals + counts.classicRentals + counts.serviceTickets +
    counts.clients + counts.payments + counts.documents + counts.shippingPhotos;

  const canConfirm = confirmText.trim().toLowerCase() === 'сброс';

  const handleOpenDialog = () => {
    setCounts(getDataCounts()); // refresh counts
    setConfirmText('');
    setDone(false);
    setDialogOpen(true);
  };

  const handleReset = () => {
    setResetting(true);
    try {
      // Удаляем все транзакционные данные
      saveGanttRentals([]);
      saveServiceTickets([]);
      saveClients([]);
      savePayments([]);
      saveDocuments([]);
      saveShippingPhotos([]);
      localStorage.removeItem(RENTALS_STORAGE_KEY);

      // Сбрасываем статус техники → свободна, убираем арендатора и дату возврата
      const equipment = loadEquipment();
      const resetEquipment = equipment.map(eq => {
        const { currentClient: _cc, returnDate: _rd, ...rest } = eq;
        return { ...rest, status: 'available' as const };
      });
      saveEquipment(resetEquipment);

      setCounts(getDataCounts());
      setDone(true);
    } finally {
      setResetting(false);
    }
  };

  const deletableRows: { label: string; count: number; key: string }[] = [
    { key: 'ganttRentals',  label: 'Аренды (планировщик)',     count: counts.ganttRentals },
    { key: 'classicRentals',label: 'Аренды (классические)',    count: counts.classicRentals },
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
                onClick={() => { setCounts(getDataCounts()); setDone(false); }}
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
              onClick={() => { handleReset(); setDialogOpen(false); }}
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
  const [owners, setOwnersState] = React.useState<Owner[]>(loadOwners);
  const [adding,     setAdding]    = React.useState(false);
  const [newValue,   setNewValue]  = React.useState('');
  const [editId,     setEditId]    = React.useState<string | null>(null);
  const [editValue,  setEditValue] = React.useState('');

  const persist = (next: Owner[]) => {
    setOwnersState(next);
    saveOwners(next);
  };

  const handleAdd = () => {
    if (!newValue.trim()) return;
    persist([...owners, { id: `own-${Date.now()}`, name: newValue.trim() }]);
    setNewValue('');
    setAdding(false);
  };

  const handleEditSave = (id: string) => {
    if (!editValue.trim()) return;
    persist(owners.map(o => o.id === id ? { ...o, name: editValue.trim() } : o));
    setEditId(null);
  };

  const handleDelete = (id: string) => {
    persist(owners.filter(o => o.id !== id));
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
