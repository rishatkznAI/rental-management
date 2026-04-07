import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { usePermissions } from '../lib/permissions';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { ArrowLeft, Info } from 'lucide-react';
import { loadClients, saveClients } from '../mock-data';
import { loadUsers } from '../lib/userStorage';
import type { Client } from '../types';

const PAYMENT_TERMS_OPTIONS = [
  { value: 'Постоплата 14 дней', label: 'Постоплата 14 дней' },
  { value: 'Постоплата 30 дней', label: 'Постоплата 30 дней' },
  { value: 'Предоплата 100%',    label: 'Предоплата 100%' },
  { value: 'Предоплата 50%',     label: 'Предоплата 50%' },
  { value: 'Без предоплаты',     label: 'Без предоплаты' },
];

// ── вспомогательный компонент поля ───────────────────────────────────────────

function FieldWrapper({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {children}
      {hint && (
        <p className="flex items-start gap-1.5 text-xs text-gray-400 dark:text-gray-500">
          <Info className="mt-0.5 h-3 w-3 flex-shrink-0" />
          {hint}
        </p>
      )}
    </div>
  );
}

// ── основной компонент ────────────────────────────────────────────────────────

export default function ClientNew() {
  const navigate = useNavigate();
  const { can } = usePermissions();

  useEffect(() => {
    if (!can('create', 'clients')) navigate('/clients', { replace: true });
  }, []);

  // Менеджеры из системы — только активные
  const managers = React.useMemo(
    () => loadUsers().filter(u => u.status === 'Активен'),
    [],
  );

  const [formData, setFormData] = useState({
    companyName:  '',
    inn:          '',
    phone:        '',
    contactName:  '',
    email:        '',
    address:      '',
    paymentTerms: 'Постоплата 14 дней',
    creditLimit:  '',
    manager:      '',
    notes:        '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const existing = loadClients();
    const now = new Date().toISOString();
    const newClient: Client = {
      id:           `c-${Date.now()}`,
      company:      formData.companyName,
      inn:          formData.inn,
      contact:      formData.contactName,
      phone:        formData.phone,
      email:        formData.email,
      address:      formData.address   || undefined,
      paymentTerms: formData.paymentTerms || 'Постоплата 14 дней',
      creditLimit:  formData.creditLimit ? Number(formData.creditLimit) : 0,
      debt:         0,
      totalRentals: 0,
      manager:      formData.manager   || undefined,
      notes:        formData.notes     || undefined,
      status:       'active',
      createdAt:    now,
      createdBy:    'Оператор',
    };
    saveClients([...existing, newClient]);
    navigate(`/clients/${newClient.id}`);
  };

  const fieldClass =
    'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]';

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">

      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="secondary" onClick={() => navigate('/clients')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Новый клиент</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Добавление нового клиента в систему</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* ── Основная информация ────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Основная информация</CardTitle>
            <CardDescription>Реквизиты компании</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Наименование компании"
              placeholder="ООО «Компания»"
              value={formData.companyName}
              onChange={e => setFormData({ ...formData, companyName: e.target.value })}
              required
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="ИНН"
                placeholder="1234567890"
                value={formData.inn}
                onChange={e => setFormData({ ...formData, inn: e.target.value })}
                required
              />
              <Input
                label="Email"
                placeholder="info@company.ru"
                type="email"
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <FieldWrapper label="Адрес">
              <textarea
                className={fieldClass}
                rows={2}
                placeholder="Юридический / фактический адрес"
                value={formData.address}
                onChange={e => setFormData({ ...formData, address: e.target.value })}
              />
            </FieldWrapper>
          </CardContent>
        </Card>

        {/* ── Контактное лицо ───────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Контактное лицо</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Имя контактного лица"
              placeholder="Иванов Иван Иванович"
              value={formData.contactName}
              onChange={e => setFormData({ ...formData, contactName: e.target.value })}
              required
            />
            <Input
              label="Телефон"
              placeholder="+7 (999) 123-45-67"
              type="tel"
              value={formData.phone}
              onChange={e => setFormData({ ...formData, phone: e.target.value })}
              required
            />
          </CardContent>
        </Card>

        {/* ── Коммерческие условия ──────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Коммерческие условия</CardTitle>
            <CardDescription>
              Условия работы с клиентом, лимиты и ответственный менеджер
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Условия оплаты */}
            <FieldWrapper
              label="Условия оплаты"
              hint="Определяет, когда клиент обязан оплатить — до или после отгрузки"
            >
              <Select
                value={formData.paymentTerms}
                onValueChange={v => setFormData({ ...formData, paymentTerms: v })}
              >
                <SelectTrigger className="w-full dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                  <SelectValue placeholder="Выберите условия оплаты" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_TERMS_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldWrapper>

            {/* Лимит работы в долг */}
            <FieldWrapper
              label="Лимит работы в долг, ₽"
              hint={
                Number(formData.creditLimit) === 0 || formData.creditLimit === ''
                  ? 'Значение 0 означает, что работа в долг не разрешена — клиент обязан оплачивать заранее или по факту'
                  : 'Максимально допустимая задолженность клиента — сверх этой суммы новые отгрузки блокируются'
              }
            >
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  step={1000}
                  placeholder="0"
                  value={formData.creditLimit}
                  onChange={e => setFormData({ ...formData, creditLimit: e.target.value })}
                  className={fieldClass}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                  ₽
                </span>
              </div>
              {Number(formData.creditLimit) > 0 && (
                <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 dark:bg-amber-900/20 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
                  Клиенту разрешено работать в долг до{' '}
                  <strong>
                    {Number(formData.creditLimit).toLocaleString('ru-RU')} ₽
                  </strong>
                </p>
              )}
            </FieldWrapper>

            {/* Ответственный менеджер */}
            <FieldWrapper
              label="Ответственный менеджер"
              hint="Сотрудник, который привёл или ведёт этого клиента. Используется в отчётах по менеджерам"
            >
              <Select
                value={formData.manager}
                onValueChange={v => setFormData({ ...formData, manager: v })}
              >
                <SelectTrigger className="w-full dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                  <SelectValue placeholder="Выберите менеджера из списка" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="—">— Не назначен</SelectItem>
                  {managers.map(u => (
                    <SelectItem key={u.id} value={u.name}>
                      {u.name}
                      <span className="ml-2 text-xs text-gray-400">{u.role}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {managers.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Нет активных сотрудников — добавьте менеджеров в разделе «Настройки → Пользователи».
                </p>
              )}
            </FieldWrapper>

            {/* Примечания */}
            <FieldWrapper
              label="Примечания"
              hint="Особые условия работы, договорённости, важные комментарии по клиенту"
            >
              <textarea
                className={fieldClass}
                rows={3}
                placeholder="Например: работает только по предоплате, скидка 5% от 500 тыс., контактировать только через email..."
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
              />
            </FieldWrapper>

          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit">Создать клиента</Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/clients')}>
            Отмена
          </Button>
        </div>
      </form>
    </div>
  );
}
