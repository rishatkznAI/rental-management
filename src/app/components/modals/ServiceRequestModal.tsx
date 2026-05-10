import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Upload } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { animatedModalClassName, animatedOverlayClassName } from '../../lib/animations';

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
        <Dialog.Overlay className={animatedOverlayClassName()} />
        <Dialog.Content className={animatedModalClassName('flex !max-h-[85vh] !w-[calc(100vw-2rem)] !max-w-2xl flex-col overflow-hidden border-slate-200/90 bg-white p-0 dark:border-gray-800 dark:bg-gray-950')}>
          <div className="shrink-0 border-b border-slate-100 px-6 py-5 pr-14 dark:border-gray-800">
            <div className="flex items-start justify-between gap-4">
              <Dialog.Title className="text-xl font-semibold text-slate-950 dark:text-white">
                Новая заявка в сервис
              </Dialog.Title>
              <Dialog.Close asChild>
                <button className="absolute right-4 top-4 inline-flex size-9 items-center justify-center rounded-xl border border-transparent text-slate-400 transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700 dark:text-gray-500 dark:hover:border-gray-800 dark:hover:bg-gray-900 dark:hover:text-gray-200">
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="mt-2 text-sm leading-6 text-slate-500 dark:text-gray-400">
              Заполните форму для создания новой заявки в сервис
            </Dialog.Description>
          </div>

          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5 pr-5">
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
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Описание проблемы
                </label>
                <textarea
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  rows={3}
                  placeholder="Не реагирует на команды"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Фото/видео неисправности
                </label>
                <div className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-6 text-center transition-colors hover:border-[--color-primary] dark:border-gray-600">
                  <Upload className="mx-auto mb-2 h-8 w-8 text-gray-400" />
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Нажмите или перетащите файлы сюда
                  </p>
                  <p className="mt-1 text-xs text-gray-500">PNG, JPG, MP4 до 10MB</p>
                </div>
              </div>

              <Input
                label="Адрес объекта"
                placeholder="ОЭЗ синергия 27"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Примечание
                </label>
                <textarea
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  rows={2}
                  placeholder="Дополнительная информация"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>
            </div>

            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 px-6 py-4 sm:flex-row dark:border-gray-800 dark:bg-gray-950/95">
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
