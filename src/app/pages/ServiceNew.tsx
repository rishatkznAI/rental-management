import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { ArrowLeft, Upload } from 'lucide-react';
import { loadServiceTickets, saveServiceTickets } from '../mock-data';

export default function ServiceNew() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    urgency: '',
    contact: '',
    model: '',
    serialNumber: '',
    description: '',
    address: '',
    notes: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const existing = loadServiceTickets();
    const newTicket = {
      id: `SRV-${Date.now()}`,
      equipmentId: '',
      equipment: `${formData.model} (SN: ${formData.serialNumber})`,
      reason: formData.description,
      description: formData.notes || formData.description,
      priority: (formData.urgency || 'medium') as 'low' | 'medium' | 'high' | 'critical',
      sla: '24 ч',
      assignedTo: formData.contact,
      status: 'new' as const,
      workLog: [],
      parts: [],
      createdAt: new Date().toISOString(),
    };
    saveServiceTickets([...existing, newTicket]);
    navigate('/service');
  };

  return (
    <div className="space-y-6 p-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="secondary" onClick={() => navigate('/service')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Новая заявка в сервис</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Создание заявки на обслуживание техники</p>
        </div>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle>Информация о неисправности</CardTitle>
          <CardDescription>Заполните детали заявки</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Select
              label="Срочность"
              placeholder="Выберите срочность"
              value={formData.urgency}
              onValueChange={(value) => setFormData({ ...formData, urgency: value })}
              options={[
                { value: 'low', label: 'Низкая' },
                { value: 'medium', label: 'Средняя' },
                { value: 'high', label: 'Высокая' },
                { value: 'critical', label: 'Критическая' }
              ]}
            />

            <Input
              label="Контактное лицо"
              placeholder="+7 939 365-32-09 Сергей"
              value={formData.contact}
              onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
              required
            />

            <Input
              label="Модель подъёмника"
              placeholder="Mantall XE160W"
              value={formData.model}
              onChange={(e) => setFormData({ ...formData, model: e.target.value })}
              required
            />

            <Input
              label="Серийный номер"
              placeholder="03323405"
              value={formData.serialNumber}
              onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
              required
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Описание проблемы
              </label>
              <textarea
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                rows={3}
                placeholder="Не реагирует на команды"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Фото/видео неисправности
              </label>
              <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center hover:border-[--color-primary] transition-colors cursor-pointer">
                <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Нажмите или перетащите файлы сюда
                </p>
                <p className="text-xs text-gray-500 mt-1">PNG, JPG, MP4 до 10MB</p>
              </div>
            </div>

            <Input
              label="Адрес объекта"
              placeholder="ОЭЗ синергия 27"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              required
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Примечание
              </label>
              <textarea
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                rows={2}
                placeholder="Дополнительная информация"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="submit">
                Создать заявку
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate('/service')}
              >
                Отмена
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
