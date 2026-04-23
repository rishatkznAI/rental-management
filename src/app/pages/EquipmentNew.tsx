import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { usePermissions } from '../lib/permissions';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  ArrowLeft, Save, Tag, Wrench, MapPin, TrendingUp,
  ClipboardList, Calendar, Info, Bot, MessageSquare,
} from 'lucide-react';
import { useCreateEquipment } from '../hooks/useEquipment';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { createAuditEntry } from '../lib/entity-history';
import { EQUIPMENT_CATEGORY_LABELS, EQUIPMENT_PRIORITY_LABELS, EQUIPMENT_SALE_PDI_LABELS } from '../lib/equipmentClassification';

// ─── Вспомогательные компоненты ────────────────────────────────────────────

/** Мелкая подсказка под полем */
function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
      {children}
    </p>
  );
}

/** Выпадающий список с label, placeholder и подсказкой */
function SelectField({
  label,
  placeholder = 'Выберите значение',
  value,
  onValueChange,
  options,
  hint,
  required,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  hint?: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="w-full rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <FieldHint>{hint}</FieldHint>}
    </div>
  );
}

/** Поле даты с иконкой календаря */
function DateField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      <div className="relative">
        <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="date"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="h-9 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm
                     focus:outline-none focus:ring-2 focus:ring-[--color-primary] focus:border-transparent
                     dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
      </div>
      <FieldHint>{hint}</FieldHint>
    </div>
  );
}

/** Разделитель внутри карточки */
function InnerDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
    </div>
  );
}

// ─── Mock-данные для журнала ────────────────────────────────────────────────
const JOURNAL_PREVIEW = [
  { id: 'ev1', date: '22.03.2026', type: 'Комментарий механика', text: 'Требуется замена пульта управления',        source: 'bot'    as const },
  { id: 'ev2', date: '18.03.2026', type: 'Осмотр',              text: 'Выявлена утечка масла в гидравлическом блоке', source: 'bot'  as const },
  { id: 'ev3', date: '12.03.2026', type: 'Ремонт',              text: 'Замена гидравлического шланга',              source: 'manual' as const },
];
const eventTypeBadge: Record<string, string> = {
  'Ремонт':              'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  'Осмотр':              'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  'Комментарий механика':'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

// ───────────────────────────────────────────────────────────────────────────

const DEFAULT_OWNERS = [
  { id: 'own-1', name: 'ООО «Скайтех компани»' },
  { id: 'own-2', name: 'Частный инвестор 1' },
  { id: 'own-3', name: 'Субаренда' },
];

export default function EquipmentNew() {
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = usePermissions();
  const { user } = useAuth();
  const createEquipment = useCreateEquipment();
  const [owners, setOwners] = React.useState(DEFAULT_OWNERS);
  const isSaleMode = useMemo(() => new URLSearchParams(location.search).get('sale') === '1', [location.search]);

  // Защита от прямого перехода без прав
  useEffect(() => {
    if (!can('create', 'equipment')) navigate('/equipment', { replace: true });
  }, []);

  // Загружаем собственников из API (с fallback на defaults)
  useEffect(() => {
    api.get<typeof DEFAULT_OWNERS>('/api/owners').then(list => {
      if (list && list.length > 0) setOwners(list);
    }).catch(() => {});
  }, []);

  const defaultOwnerId = owners.length > 0 ? owners[0].id : '';

  const [form, setForm] = useState({
    inventoryNumber: '',
    serialNumber: '',
    manufacturer: '',
    model: '',
    type: 'scissor',
    drive: 'electric',
    year: '',
    liftHeight: '',
    hours: '',
    maintenanceCHTO: '',
    maintenancePTO: '',
    ownerId: defaultOwnerId,
    category: 'own',
    priority: 'medium',
    activeInFleet: 'yes',
    isForSale: isSaleMode ? 'yes' : 'no',
    salePdiStatus: 'not_started',
    salePrice1: '',
    salePrice2: '',
    salePrice3: '',
    subleasePrice: '',
    location: '',
    status: 'available',
    plannedMonthlyRevenue: '',
    notes: '',
  });

  const update = (field: string, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  useEffect(() => {
    if (!isSaleMode) return;
    setForm(prev => ({
      ...prev,
      isForSale: 'yes',
      inventoryNumber: '',
      activeInFleet: 'no',
    }));
  }, [isSaleMode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const selectedOwner = owners.find(o => o.id === form.ownerId);
    const ownerName = selectedOwner?.name ?? '';
    const ownerType = ownerName.toLowerCase().includes('субар') ? 'sublease'
      : ownerName.toLowerCase().includes('инвест') ? 'investor'
      : 'own';

    createEquipment.mutate({
      inventoryNumber:       isSaleMode ? '' : form.inventoryNumber,
      manufacturer:          form.manufacturer,
      model:                 form.model,
      type:                  form.type as 'scissor' | 'articulated' | 'telescopic',
      drive:                 form.drive as 'diesel' | 'electric',
      serialNumber:          form.serialNumber,
      year:                  Number(form.year) || new Date().getFullYear(),
      hours:                 Number(form.hours) || 0,
      liftHeight:            Number(form.liftHeight) || 0,
      location:              form.location,
      status:                form.status as 'available' | 'rented' | 'reserved' | 'in_service' | 'inactive',
      owner:                 ownerType as 'own' | 'investor' | 'sublease',
      ownerId:               selectedOwner?.id || undefined,
      ownerName:             ownerName || undefined,
      category:              form.category as 'own' | 'sold' | 'client' | 'partner',
      priority:              form.priority as 'low' | 'medium' | 'high' | 'critical',
      activeInFleet:         form.activeInFleet === 'yes',
      isForSale:             form.isForSale === 'yes',
      salePdiStatus:         form.isForSale === 'yes' ? form.salePdiStatus as 'not_started' | 'in_progress' | 'ready' : undefined,
      salePrice1:            form.isForSale === 'yes' && form.salePrice1 ? Number(form.salePrice1) : undefined,
      salePrice2:            form.isForSale === 'yes' && form.salePrice2 ? Number(form.salePrice2) : undefined,
      salePrice3:            form.isForSale === 'yes' && form.salePrice3 ? Number(form.salePrice3) : undefined,
      subleasePrice:         form.subleasePrice ? Number(form.subleasePrice) : undefined,
      plannedMonthlyRevenue: Number(form.plannedMonthlyRevenue) || 0,
      nextMaintenance:       new Date().toISOString().split('T')[0],
      maintenanceCHTO:       form.maintenanceCHTO || undefined,
      maintenancePTO:        form.maintenancePTO || undefined,
      notes:                 form.notes || undefined,
      history: [
        createAuditEntry(
          user?.name || 'Система',
          `Техника создана: ${[form.manufacturer, form.model, form.serialNumber ? `SN ${form.serialNumber}` : ''].filter(Boolean).join(' · ')}`,
        ),
      ],
    }, { onSuccess: () => navigate(isSaleMode ? '/sales' : '/equipment') });
  };

  const createError =
    createEquipment.error instanceof Error
      ? createEquipment.error.message
      : '';

  // Текущий собственник (для условных подсказок)
  const selectedOwnerName = (owners.find(o => o.id === form.ownerId)?.name ?? '').toLowerCase();
  const isInvestor  = selectedOwnerName.includes('инвест');
  const isSublease  = selectedOwnerName.includes('субар');

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8 max-w-3xl mx-auto">
      {/* Шапка */}
      <div>
        <Link
          to="/equipment"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Вернуться к списку
        </Link>
        <h1 className="mt-4 text-2xl font-bold sm:text-3xl text-gray-900 dark:text-white">
          {isSaleMode ? 'Добавить технику в продажи' : 'Добавить технику'}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {isSaleMode ? 'Заполните карточку продажной техники' : 'Заполните карточку новой единицы техники'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ─── 1 · Идентификация техники ─── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-gray-400" />
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                1 · Идентификация техники
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Input
                  label="Серийный номер"
                  placeholder="Например, GS-SN-20240012"
                  value={form.serialNumber}
                  onChange={e => update('serialNumber', e.target.value)}
                  required
                />
                <FieldHint>Заводской номер из паспорта или шильдика</FieldHint>
              </div>
              {!isSaleMode && (
                <div>
                  <Input
                    label="Инвентарный номер"
                    placeholder="Например, INV-006"
                    value={form.inventoryNumber}
                    onChange={e => update('inventoryNumber', e.target.value)}
                    required
                  />
                  <FieldHint>Внутренний номер учёта из реестра компании</FieldHint>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Производитель"
                placeholder="Например, Genie, JLG, Haulotte"
                value={form.manufacturer}
                onChange={e => update('manufacturer', e.target.value)}
                required
              />
              <Input
                label="Модель"
                placeholder="Например, GS-3246, S-40"
                value={form.model}
                onChange={e => update('model', e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectField
                label="Приоритет техники"
                value={form.priority}
                onValueChange={(value) => update('priority', value)}
                options={[
                  { value: 'critical', label: EQUIPMENT_PRIORITY_LABELS.critical },
                  { value: 'high', label: EQUIPMENT_PRIORITY_LABELS.high },
                  { value: 'medium', label: EQUIPMENT_PRIORITY_LABELS.medium },
                  { value: 'low', label: EQUIPMENT_PRIORITY_LABELS.low },
                ]}
                hint="Используется для сортировки техники в списках и планировщике аренды."
                required
              />
            </div>
          </CardContent>
        </Card>

        {/* ─── 2 · Характеристики ─── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-gray-400" />
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                2 · Характеристики
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">

            <div className="grid grid-cols-2 gap-4">
              <SelectField
                label="Тип подъёмника"
                placeholder="Выберите тип"
                value={form.type}
                onValueChange={v => update('type', v)}
                options={[
                  { value: 'scissor',     label: 'Ножничный (Scissor Lift)' },
                  { value: 'articulated', label: 'Коленчатый (Boom Lift)' },
                  { value: 'telescopic',  label: 'Телескопический (Telehandler)' },
                ]}
                hint="Конструктивный тип платформы"
              />
              <SelectField
                label="Тип привода"
                placeholder="Выберите привод"
                value={form.drive}
                onValueChange={v => update('drive', v)}
                options={[
                  { value: 'electric', label: 'Электрический' },
                  { value: 'diesel',   label: 'Дизельный' },
                ]}
                hint="Влияет на допустимые условия работы"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Input
                  label="Год выпуска"
                  type="number"
                  placeholder="Например, 2022"
                  value={form.year}
                  onChange={e => update('year', e.target.value)}
                  required
                />
                <FieldHint>Год производства из паспорта техники</FieldHint>
              </div>
              <div>
                <Input
                  label="Рабочая высота, м"
                  type="number"
                  step="0.1"
                  placeholder="Например, 12.0"
                  value={form.liftHeight}
                  onChange={e => update('liftHeight', e.target.value)}
                  required
                />
                <FieldHint>Максимальная высота подъёма платформы</FieldHint>
              </div>
              <div>
                <Input
                  label="Наработка, м/ч"
                  type="number"
                  placeholder="Например, 1250"
                  value={form.hours}
                  onChange={e => update('hours', e.target.value)}
                />
                <FieldHint>Моточасы с начала эксплуатации</FieldHint>
              </div>
            </div>

            {!isSaleMode && (
              <>
                <InnerDivider label="Техническое обслуживание" />

                <div className="grid grid-cols-2 gap-4">
                  <DateField
                    label="Дата ЧТО"
                    hint="ЧТО — частичное техническое обслуживание. Дата последней плановой проверки агрегатов."
                    value={form.maintenanceCHTO}
                    onChange={v => update('maintenanceCHTO', v)}
                  />
                  <DateField
                    label="Дата ПТО"
                    hint="ПТО — периодический технический осмотр. Дата последней полной проверки с заменой расходников."
                    value={form.maintenancePTO}
                    onChange={v => update('maintenancePTO', v)}
                  />
                </div>

                <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-900/20">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    Если даты неизвестны — оставьте пустыми. Система напомнит о приближении срока обслуживания
                    на основе нормативов пробега.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ─── 3 · Владение и размещение ─── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-gray-400" />
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                3 · Владение и размещение
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">

            {/* Собственник + статус */}
            <div className="grid grid-cols-2 gap-4">
              {/* Собственник из справочника */}
              <div>
                {owners.length === 0 ? (
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Собственник техники
                    </label>
                    <div className="flex h-9 items-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 dark:border-gray-600 dark:bg-gray-800/50">
                      <p className="text-sm text-gray-400 dark:text-gray-500">
                        Нет собственников —{' '}
                        <Link to="/settings" className="text-blue-600 hover:underline dark:text-blue-400">
                          добавьте в справочнике
                        </Link>
                      </p>
                    </div>
                    <FieldHint>
                      Перейдите в{' '}
                      <Link to="/settings" className="text-blue-600 hover:underline dark:text-blue-400">
                        Настройки → Справочники → Собственники техники
                      </Link>
                    </FieldHint>
                  </div>
                ) : (
                  <SelectField
                    label="Собственник техники"
                    placeholder="Выберите собственника"
                    value={form.ownerId}
                    onValueChange={v => update('ownerId', v)}
                    options={owners.map(o => ({ value: o.id, label: o.name }))}
                    hint={
                      <>
                        Список ведётся в{' '}
                        <Link to="/settings" className="text-blue-600 hover:underline dark:text-blue-400">
                          Настройки → Справочники
                        </Link>
                      </>
                    }
                    required
                  />
                )}
              </div>

              {/* Статус */}
              <SelectField
                label="Статус техники"
                placeholder="Выберите статус"
                value={form.status}
                onValueChange={v => update('status', v)}
                options={[
                  { value: 'available',  label: 'Свободна' },
                  { value: 'rented',     label: 'В аренде' },
                  { value: 'reserved',   label: 'Забронирована' },
                  { value: 'in_service', label: 'В сервисе' },
                  { value: 'inactive',   label: 'Списана' },
                ]}
                hint="Текущий статус на момент добавления"
              />
            </div>

            {isSaleMode ? (
              <>
                <SelectField
                  label="В продаже или нет"
                  value={form.isForSale}
                  onValueChange={v => update('isForSale', v)}
                  options={[
                    { value: 'yes', label: 'Да, техника в продаже' },
                    { value: 'no', label: 'Нет, пока не выставлена' },
                  ]}
                  hint="Управляет попаданием техники во вкладку «Продажи»."
                  required
                />

                {form.isForSale === 'yes' && (
                  <>
                    <SelectField
                      label="Статус PDI"
                      value={form.salePdiStatus}
                      onValueChange={v => update('salePdiStatus', v)}
                      options={[
                        { value: 'not_started', label: EQUIPMENT_SALE_PDI_LABELS.not_started },
                        { value: 'in_progress', label: EQUIPMENT_SALE_PDI_LABELS.in_progress },
                        { value: 'ready', label: EQUIPMENT_SALE_PDI_LABELS.ready },
                      ]}
                      hint="Показывает, готова ли техника к продаже и передаче клиенту."
                    />

                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <Input
                          label="Цена 1, ₽"
                          type="number"
                          placeholder="Например, 4 950 000"
                          value={form.salePrice1}
                          onChange={e => update('salePrice1', e.target.value)}
                        />
                      </div>
                      <div>
                        <Input
                          label="Цена 2, ₽"
                          type="number"
                          placeholder="Например, 4 750 000"
                          value={form.salePrice2}
                          onChange={e => update('salePrice2', e.target.value)}
                        />
                      </div>
                      <div>
                        <Input
                          label="Цена 3, ₽"
                          type="number"
                          placeholder="Например, 4 550 000"
                          value={form.salePrice3}
                          onChange={e => update('salePrice3', e.target.value)}
                        />
                      </div>
                    </div>
                    <FieldHint>
                      Можно использовать три уровня цены как рекомендованную, переговорную и минимально допустимую.
                    </FieldHint>
                  </>
                )}
              </>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <SelectField
                  label="Категория техники"
                  value={form.category}
                  onValueChange={v => update('category', v)}
                  options={[
                    { value: 'own', label: EQUIPMENT_CATEGORY_LABELS.own },
                    { value: 'sold', label: EQUIPMENT_CATEGORY_LABELS.sold },
                    { value: 'client', label: EQUIPMENT_CATEGORY_LABELS.client },
                    { value: 'partner', label: EQUIPMENT_CATEGORY_LABELS.partner },
                  ]}
                  hint="Используется для разделения списка техники и допуска в аренду"
                  required
                />

                <SelectField
                  label="Участвует в активном парке"
                  value={form.activeInFleet}
                  onValueChange={v => update('activeInFleet', v)}
                  options={[
                    { value: 'yes', label: 'Да' },
                    { value: 'no', label: 'Нет' },
                  ]}
                  hint="В аренде может участвовать только техника из активного парка"
                  required
                />
              </div>
            )}

            {/* Условные подсказки по типу владения */}
            {isSublease && (
              <>
                <div>
                  <Input
                    label="Стоимость субаренды, ₽/мес"
                    type="number"
                    placeholder="Например, 55 000"
                    value={form.subleasePrice}
                    onChange={e => update('subleasePrice', e.target.value)}
                    required
                  />
                  <FieldHint>Ежемесячный платёж поставщику субаренды</FieldHint>
                </div>
                <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-300">
                  Результат = цена сдачи клиенту − стоимость субаренды
                </div>
              </>
            )}
            {isInvestor && (
              <div className="rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-700 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-300">
                Формула: от 40% выручки менеджер получает <strong>7%</strong>
              </div>
            )}
            {/* Склад / локация */}
            <SelectField
              label="Склад / местонахождение"
              placeholder="Выберите место хранения"
              value={form.location}
              onValueChange={v => update('location', v)}
              options={[
                { value: 'moscow_sklad_a', label: 'Москва — Склад А' },
                { value: 'moscow_sklad_b', label: 'Москва — Склад Б' },
                { value: 'spb_sklad_1',    label: 'Санкт-Петербург — Склад 1' },
                { value: 'kazan_sklad_1',  label: 'Казань — Склад 1' },
                { value: 'ekb_sklad_1',    label: 'Екатеринбург — Склад 1' },
                { value: 'at_client',      label: 'На объекте у клиента' },
                { value: 'at_service',     label: 'В сервисном центре' },
              ]}
              hint={
                <>
                  Список складов настраивается в{' '}
                  <Link to="/settings" className="text-blue-600 hover:underline dark:text-blue-400">
                    Настройки → Справочники
                  </Link>
                </>
              }
            />
          </CardContent>
        </Card>

        {!isSaleMode && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-gray-400" />
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  4 · Экономика
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <Input
                label="Плановый доход в месяц, ₽"
                type="number"
                placeholder="Например, 90 000"
                value={form.plannedMonthlyRevenue}
                onChange={e => update('plannedMonthlyRevenue', e.target.value)}
              />
              <FieldHint>
                Ориентир для расчёта утилизации парка. Не влияет на фактическую выручку по аренде.
              </FieldHint>
            </CardContent>
          </Card>
        )}

        {/* ─── 5 · История обслуживания и примечания ─── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-gray-400" />
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                5 · История обслуживания и примечания
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">

            <div>
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Комментарий при добавлении
                </span>
              </div>
              <textarea
                className="flex min-h-[80px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                           placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[--color-primary]
                           focus:border-transparent dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                placeholder="Особенности техники, ограничения по эксплуатации, состояние при поступлении на баланс…"
                value={form.notes}
                onChange={e => update('notes', e.target.value)}
              />
              <FieldHint>Комментарий сохраняется в карточке техники как первая запись.</FieldHint>
            </div>

            <InnerDivider label="История ремонтов и событий" />

            <div>
              <div className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 mb-4 dark:border-gray-700 dark:bg-gray-800/50">
                <Bot className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  После сохранения техники здесь будет отображаться хронологический журнал:
                  ручные записи сотрудников, а также автоматические уведомления от бота
                  (ремонты, осмотры, неисправности).
                </p>
              </div>

              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Так будет выглядеть журнал
              </p>
              <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 overflow-hidden">
                {JOURNAL_PREVIEW.map((ev, idx) => (
                  <div
                    key={ev.id}
                    className={`flex items-start gap-3 px-4 py-3 opacity-60 ${
                      idx < JOURNAL_PREVIEW.length - 1
                        ? 'border-b border-gray-200 dark:border-gray-700'
                        : ''
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {ev.source === 'bot'
                        ? <Bot className="h-4 w-4 text-violet-400" />
                        : <MessageSquare className="h-4 w-4 text-blue-400" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{ev.date}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${eventTypeBadge[ev.type] ?? 'bg-gray-100 text-gray-600'}`}>
                          {ev.type}
                        </span>
                        {ev.source === 'bot' && (
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">бот</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300 truncate">{ev.text}</p>
                    </div>
                  </div>
                ))}
              </div>
              <FieldHint>
                Записи «бот» поступают автоматически. Ручные записи добавляются в карточке техники после сохранения.
              </FieldHint>
            </div>
          </CardContent>
        </Card>

        {/* Кнопки */}
        {createError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {createError}
          </div>
        )}
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-6 dark:border-gray-700">
          <Button variant="secondary" type="button" onClick={() => navigate('/equipment')}>
            Отмена
          </Button>
          <Button type="submit" disabled={createEquipment.isPending}>
            <Save className="h-4 w-4" />
            {createEquipment.isPending ? 'Сохранение...' : 'Сохранить технику'}
          </Button>
        </div>
      </form>
    </div>
  );
}
