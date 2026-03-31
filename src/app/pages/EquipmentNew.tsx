import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { ArrowLeft, Save } from 'lucide-react';
import type { EquipmentOwnerType } from '../types';
import { loadEquipment, saveEquipment } from '../mock-data';

export default function EquipmentNew() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    manufacturer: '',
    model: '',
    serialNumber: '',
    inventoryNumber: '',
    type: 'scissor',
    drive: 'electric',
    hours: '',
    year: '',
    maintenanceCHTO: '',
    maintenancePTO: '',
    owner: 'own' as EquipmentOwnerType,
    subleasePrice: '',
    status: 'available',
    location: '',
    liftHeight: '',
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
      nextMaintenance: form.maintenancePTO || form.maintenanceCHTO || new Date().toISOString().split('T')[0],
      maintenanceCHTO: form.maintenanceCHTO || undefined,
      maintenancePTO: form.maintenancePTO || undefined,
      notes: form.notes || undefined,
    };
    saveEquipment([...existing, newEquipment]);
    navigate('/equipment');
  };

  return (
    <div className="space-y-6 p-8">
      {/* Header */}
      <div>
        <Link to="/equipment" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
          <ArrowLeft className="h-4 w-4" />
          Вернуться к списку
        </Link>
        <h1 className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">Добавить технику</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Заполните информацию о новой единице техники</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Основная информация */}
          <Card>
            <CardHeader>
              <CardTitle>Основная информация</CardTitle>
              <CardDescription>Идентификация техники</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                label="Производитель"
                placeholder="Genie, JLG, Haulotte..."
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
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Серийный номер"
                  placeholder="SN..."
                  value={form.serialNumber}
                  onChange={e => update('serialNumber', e.target.value)}
                  required
                />
                <Input
                  label="Инвентарный номер"
                  placeholder="INV-006"
                  value={form.inventoryNumber}
                  onChange={e => update('inventoryNumber', e.target.value)}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Select
                  label="Тип техники"
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
                    { value: 'electric', label: 'Электро' },
                    { value: 'diesel', label: 'Дизель' },
                  ]}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Год выпуска"
                  type="number"
                  placeholder="2024"
                  value={form.year}
                  onChange={e => update('year', e.target.value)}
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
              <Input
                label="Высота подъёма (м)"
                type="number"
                step="0.01"
                placeholder="12.00"
                value={form.liftHeight}
                onChange={e => update('liftHeight', e.target.value)}
                required
              />
            </CardContent>
          </Card>

          {/* Владение и статус */}
          <Card>
            <CardHeader>
              <CardTitle>Владение и статус</CardTitle>
              <CardDescription>Владелец, статус и расположение</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                label="Владелец техники"
                value={form.owner}
                onValueChange={v => update('owner', v)}
                options={[
                  { value: 'own', label: 'Собственная' },
                  { value: 'investor', label: 'Техника инвестора' },
                  { value: 'sublease', label: 'Субаренда' },
                ]}
              />
              {form.owner === 'sublease' && (
                <Input
                  label="Стоимость, по которой взяли (₽/мес)"
                  type="number"
                  placeholder="55000"
                  value={form.subleasePrice}
                  onChange={e => update('subleasePrice', e.target.value)}
                  required
                />
              )}
              {form.owner === 'own' && (
                <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                  Менеджер получает <span className="font-medium">3%</span> от результата по собственной технике
                </div>
              )}
              {form.owner === 'investor' && (
                <div className="rounded-lg bg-purple-50 p-3 text-sm text-purple-700 dark:bg-purple-900/20 dark:text-purple-300">
                  Формула: от 40% выручки менеджер получает <span className="font-medium">7%</span>
                </div>
              )}
              {form.owner === 'sublease' && (
                <div className="rounded-lg bg-orange-50 p-3 text-sm text-orange-700 dark:bg-orange-900/20 dark:text-orange-300">
                  Результат = цена сдачи − цена взятия в субаренду
                </div>
              )}
              <Select
                label="Статус техники"
                value={form.status}
                onValueChange={v => update('status', v)}
                options={[
                  { value: 'available', label: 'Свободен' },
                  { value: 'rented', label: 'В аренде' },
                  { value: 'reserved', label: 'Бронь' },
                  { value: 'in_service', label: 'В сервисе' },
                  { value: 'inactive', label: 'Списан' },
                ]}
              />
              <Input
                label="Локация"
                placeholder="Москва, склад А"
                value={form.location}
                onChange={e => update('location', e.target.value)}
                required
              />
              <Input
                label="Плановый доход в месяц (₽)"
                type="number"
                placeholder="90000"
                value={form.plannedMonthlyRevenue}
                onChange={e => update('plannedMonthlyRevenue', e.target.value)}
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Дата ЧТО"
                  type="date"
                  value={form.maintenanceCHTO}
                  onChange={e => update('maintenanceCHTO', e.target.value)}
                />
                <Input
                  label="Дата ПТО"
                  type="date"
                  value={form.maintenancePTO}
                  onChange={e => update('maintenancePTO', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Примечание</label>
                <textarea
                  className="flex min-h-[80px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[--color-primary] focus:border-transparent dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  placeholder="Дополнительная информация..."
                  value={form.notes}
                  onChange={e => update('notes', e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-6 dark:border-gray-700">
          <Button variant="secondary" type="button" onClick={() => navigate('/equipment')}>
            Отмена
          </Button>
          <Button type="submit">
            <Save className="h-4 w-4" />
            Сохранить
          </Button>
        </div>
      </form>
    </div>
  );
}
