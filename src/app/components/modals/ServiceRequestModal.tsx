import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Upload } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select } from '../ui/select';

interface ServiceRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ServiceRequestModal({ open, onOpenChange }: ServiceRequestModalProps) {
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
    console.log('Service request:', formData);
    onOpenChange(false);
    // Reset form
    setFormData({
      urgency: '',
      contact: '',
      model: '',
      serialNumber: '',
      description: '',
      address: '',
      notes: ''
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white dark:bg-gray-800 p-6 shadow-lg max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-gray-900 dark:text-white">
              Новая заявка в сервис
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-full p-1 hover:bg-gray-100 dark:hover:bg-gray-700">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Заполните форму для создания новой заявки в сервис
          </Dialog.Description>

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
            />

            <Input
              label="Модель подъёмника"
              placeholder="Mantall XE160W"
              value={formData.model}
              onChange={(e) => setFormData({ ...formData, model: e.target.value })}
            />

            <Input
              label="Серийный номер"
              placeholder="03323405"
              value={formData.serialNumber}
              onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
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
              <Button type="submit" className="flex-1">
                Создать заявку
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}