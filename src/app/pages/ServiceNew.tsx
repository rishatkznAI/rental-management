import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { ArrowLeft } from 'lucide-react';
import { loadServiceTickets, saveServiceTickets } from '../mock-data';
import { loadEquipment } from '../mock-data';
import type { ServiceTicket } from '../types';

export default function ServiceNew() {
  const navigate = useNavigate();
  const equipmentList = loadEquipment();

  const [formData, setFormData] = useState({
    equipmentId: '',
    inventoryNumber: '',
    serialNumber: '',
    location: '',
    priority: 'medium',
    contact: '',
    reason: '',
    description: '',
    notes: '',
    assignedTo: '',
    plannedDate: '',
  });

  const selectedEquipment = equipmentList.find(e => e.id === formData.equipmentId);

  const handleEquipmentChange = (val: string) => {
    const eq = equipmentList.find(e => e.id === val);
    setFormData(prev => ({
      ...prev,
      equipmentId: val,
      inventoryNumber: eq ? eq.inventoryNumber : prev.inventoryNumber,
      serialNumber: eq ? eq.serialNumber : prev.serialNumber,
      location: eq ? eq.location : prev.location,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const existing = loadServiceTickets();
    const eq = equipmentList.find(e => e.id === formData.equipmentId);
    const equipmentLabel = eq
      ? `${eq.manufacturer} ${eq.model} (INV: ${eq.inventoryNumber})`
      : formData.inventoryNumber
      ? `Инв. ${formData.inventoryNumber}${formData.serialNumber ? ` / SN: ${formData.serialNumber}` : ''}`
      : 'Не указана';

    const now = new Date().toISOString();
    const newTicket: ServiceTicket = {
      id: `SRV-${Date.now()}`,
      equipmentId: formData.equipmentId || '',
      equipment: equipmentLabel,
      inventoryNumber: eq ? eq.inventoryNumber : formData.inventoryNumber,
      serialNumber: eq ? eq.serialNumber : formData.serialNumber,
      equipmentType: eq ? eq.type : undefined,
      location: eq ? eq.location : formData.location,
      reason: formData.reason || formData.description,
      description: formData.description,
      priority: (formData.priority || 'medium') as ServiceTicket['priority'],
      sla: formData.priority === 'critical' ? '4 ч' : formData.priority === 'high' ? '8 ч' : '24 ч',
      assignedTo: formData.assignedTo || undefined,
      createdBy: formData.contact || 'Оператор',
      source: 'manual',
      status: 'new',
      plannedDate: formData.plannedDate || undefined,
      workLog: [
        {
          date: now,
          text: 'Заявка создана',
          author: formData.contact || 'Оператор',
          type: 'status_change',
        },
      ],
      parts: [],
      createdAt: now,
    };
    saveServiceTickets([...existing, newTicket]);
    navigate(`/service/${newTicket.id}`);
  };

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="secondary" onClick={() => navigate('/service')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl text-gray-900 dark:text-white">Новая заявка в сервис</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Создание заявки на обслуживание техники</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Equipment block */}
        <Card>
          <CardHeader>
            <CardTitle>Техника</CardTitle>
            <CardDescription>Укажите технику, по которой создаётся заявка</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {equipmentList.length > 0 && (
              <Select
                label="Выбрать из базы"
                placeholder="— выберите технику —"
                value={formData.equipmentId}
                onValueChange={handleEquipmentChange}
                options={equipmentList.map(e => ({
                  value: e.id,
                  label: `${e.manufacturer} ${e.model} (INV: ${e.inventoryNumber})`,
                }))}
              />
            )}
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Инвентарный номер"
                placeholder="345"
                value={selectedEquipment ? selectedEquipment.inventoryNumber : formData.inventoryNumber}
                onChange={(e) => setFormData({ ...formData, inventoryNumber: e.target.value, equipmentId: '' })}
                disabled={!!selectedEquipment}
              />
              <Input
                label="Серийный номер"
                placeholder="03323405"
                value={selectedEquipment ? selectedEquipment.serialNumber : formData.serialNumber}
                onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value, equipmentId: '' })}
                disabled={!!selectedEquipment}
              />
            </div>
            <Input
              label="Локация / склад"
              placeholder="ОЭЗ Синергия 27"
              value={selectedEquipment ? selectedEquipment.location : formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value, equipmentId: '' })}
              disabled={!!selectedEquipment}
            />
          </CardContent>
        </Card>

        {/* Problem block */}
        <Card>
          <CardHeader>
            <CardTitle>Проблема</CardTitle>
            <CardDescription>Опишите неисправность</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select
              label="Приоритет"
              placeholder="Выберите приоритет"
              value={formData.priority}
              onValueChange={(value) => setFormData({ ...formData, priority: value })}
              options={[
                { value: 'low', label: 'Низкий' },
                { value: 'medium', label: 'Средний' },
                { value: 'high', label: 'Высокий' },
                { value: 'critical', label: 'Критический' },
              ]}
            />
            <Input
              label="Причина обращения"
              placeholder="Не реагирует на команды"
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              required
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Описание неисправности
              </label>
              <textarea
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                rows={3}
                placeholder="Подробное описание проблемы..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Assignment block */}
        <Card>
          <CardHeader>
            <CardTitle>Исполнение</CardTitle>
            <CardDescription>Ответственный и сроки</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Кто подаёт заявку"
              placeholder="+7 939 365-32-09 Сергей"
              value={formData.contact}
              onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
            />
            <Input
              label="Назначить ответственного"
              placeholder="Иванов Механик"
              value={formData.assignedTo}
              onChange={(e) => setFormData({ ...formData, assignedTo: e.target.value })}
            />
            <Input
              label="Планируемая дата выполнения"
              type="date"
              value={formData.plannedDate}
              onChange={(e) => setFormData({ ...formData, plannedDate: e.target.value })}
            />
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit">Создать заявку</Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/service')}>
            Отмена
          </Button>
        </div>
      </form>
    </div>
  );
}
