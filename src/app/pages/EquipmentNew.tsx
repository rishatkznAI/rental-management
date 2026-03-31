import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { ArrowLeft, Save, Tag, Wrench, MapPin, TrendingUp, FileText } from 'lucide-react';
import type { EquipmentOwnerType } from '../types';
import { loadEquipment, saveEquipment } from '../mock-data';

export default function EquipmentNew() {
  const navigate = useNavigate();

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
    owner: 'own' as EquipmentOwnerType,
    subleasePrice: '',
    location: '',
    status: 'available',
    plannedMonthlyRevenue: '',
    notes: '',
  });

  const update = (field: string, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const existing = loadEquipment();
    const newEquipment = {
      id: `eq-${Date.now()}`,
      inventoryNumber: form.inventoryNumber,
      manufacturer: form.manufacturer,
      model: form.model,
      type: form.type as 'scissor' | 'articulated' | 'telescopic',
      drive: form.drive as 'diesel' | 'electric',
      serialNumber: form.serialNumber,
      year: Number(form.year) || new Date().getFullYear(),
      hours: Number(form.hours) || 0,
      liftHeight: Number(form.liftHeight) || 0,
      location: form.location,
      status: form.status as 'available' | 'rented' | 'reserved' | 'in_service' | 'inactive',
      owner: form.owner,
      subleasePrice: form.subleasePrice ? Number(form.subleasePrice) : undefined,
      plannedMonthlyRevenue: Number(form.plannedMonthlyRevenue) || 0,
      nextMaintenance: new Date().toISOString().split('T')[0],
      notes: form.notes || undefined,
    };
    saveEquipment([...existing, newEquipment]);
    navigate('/equipment');
  };

  return (
    <div className="space-y-6 p-8 max-w-3xl mx-auto">
      {/* Шапка */}
      <div>
        <Link
          to="/equipment"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Вернуться к списку
        </Link>
        <h1 className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">
          Добавить технику
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Заполните карточку новой единицы техники
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ─── Блок 1: Идентификация техники ─── */}
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
              <Input
                label="Инвентарный номер"
                placeholder="INV-006"
                value={form.inventoryNumber}
                onChange={e => update('inventoryNumber', e.target.value)}
                required
              />
              <Input
                label="Серийный номер"
                placeholder="SN-XXXXXXXX"
                value={form.serialNumber}
                onChange={e => update('serialNumber', e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Производитель"
                placeholder="Genie, JLG, Haulotte…"
                value={form.manufacturer}
                onChange={e => update('manufacturer', e.target.value)}
                required
              />
              <Input
                label="Модель"
                placeholder="GS-3246"
                value={form.model}
                onChange={e => update('model', e.target.value)}
                required
              />
            </div>
          </CardContent>
        </Card>

        {/* ─── Блок 2: Характеристики ─── */}
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
              <Select
                label="Тип подъёмника"
                value={form.type}
                onValueChange={v => update('type', v)}
                options={[
                  { value: 'scissor', label: 'Ножничный' },
                  { value: 'articulated', label: 'Коленчатый' },
                  { value: 'telescopic', label: 'Телескопический' },
                ]}
              />
              <Select
                label="Тип привода"
                value={form.drive}
                onValueChange={v => update('drive', v)}
                options={[
                  { value: 'electric', label: 'Электрический' },
                  { value: 'diesel', label: 'Дизельный' },
                ]}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Input
                label="Год выпуска"
                type="number"
                placeholder="2022"
                value={form.year}
                onChange={e => update('year', e.target.value)}
                required
              />
              <Input
                label="Рабочая высота, м"
                type="number"
                step="0.1"
                placeholder="12.0"
                value={form.liftHeight}
                onChange={e => update('liftHeight', e.target.value)}
                required
              />
              <Input
                label="Моточасы"
                type="number"
                placeholder="0"
                value={form.hours}
                onChange={e => update('hours', e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* ─── Блок 3: Владение и размещение ─── */}
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
            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Собственник техники"
                value={form.owner}
                onValueChange={v => update('owner', v)}
                options={[
                  { value: 'own', label: 'Собственная' },
                  { value: 'investor', label: 'Инвестор' },
                  { value: 'sublease', label: 'Субаренда (привлечённая)' },
                ]}
              />
              <Select
                label="Статус"
                value={form.status}
                onValueChange={v => update('status', v)}
                options={[
                  { value: 'available', label: 'Свободна' },
                  { value: 'rented', label: 'В аренде' },
                  { value: 'reserved', label: 'Забронирована' },
                  { value: 'in_service', label: 'В сервисе' },
                  { value: 'inactive', label: 'Списана' },
                ]}
              />
            </div>

            {/* Условные подсказки по типу владения */}
            {form.owner === 'own' && (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                Менеджер получает <strong>3%</strong> от результата по собственной технике
              </div>
            )}
            {form.owner === 'investor' && (
              <div className="rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-700 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-300">
                Формула: от 40% выручки менеджер получает <strong>7%</strong>
              </div>
            )}
            {form.owner === 'sublease' && (
              <>
                <Input
                  label="Стоимость субаренды, ₽/мес"
                  type="number"
                  placeholder="55 000"
                  value={form.subleasePrice}
                  onChange={e => update('subleasePrice', e.target.value)}
                  required
                />
                <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-300">
                  Результат = цена сдачи − стоимость субаренды
                </div>
              </>
            )}

            <Select
              label="Склад / локация"
              value={form.location}
              onValueChange={v => update('location', v)}
              options={[
                { value: '', label: '— Выберите место хранения —' },
                { value: 'moscow_sklad_a', label: 'Москва — Склад А' },
                { value: 'moscow_sklad_b', label: 'Москва — Склад Б' },
                { value: 'spb_sklad_1', label: 'Санкт-Петербург — Склад 1' },
                { value: 'kazan_sklad_1', label: 'Казань — Склад 1' },
                { value: 'ekb_sklad_1', label: 'Екатеринбург — Склад 1' },
                { value: 'at_client', label: 'На объекте у клиента' },
                { value: 'at_service', label: 'В сервисном центре' },
              ]}
            />
          </CardContent>
        </Card>

        {/* ─── Блок 4: Экономика ─── */}
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
              placeholder="90 000"
              value={form.plannedMonthlyRevenue}
              onChange={e => update('plannedMonthlyRevenue', e.target.value)}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Используется для оценки эффективности и утилизации парка. Не влияет на расчёт фактической выручки.
            </p>
          </CardContent>
        </Card>

        {/* ─── Блок 5: Примечание ─── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-gray-400" />
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                5 · Примечание
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Комментарий
              </label>
              <textarea
                className="flex min-h-[88px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[--color-primary] focus:border-transparent dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                placeholder="Особенности техники, история ремонтов, ограничения по эксплуатации…"
                value={form.notes}
                onChange={e => update('notes', e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Кнопки действий */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-6 dark:border-gray-700">
          <Button variant="secondary" type="button" onClick={() => navigate('/equipment')}>
            Отмена
          </Button>
          <Button type="submit">
            <Save className="h-4 w-4" />
            Сохранить технику
          </Button>
        </div>
      </form>
    </div>
  );
}
