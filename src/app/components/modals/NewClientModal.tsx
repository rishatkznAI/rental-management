import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { animatedModalClassName, animatedOverlayClassName } from '../../lib/animations';

interface NewClientModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewClientModal({ open, onOpenChange }: NewClientModalProps) {
  const [formData, setFormData] = useState({
    companyName: '',
    inn: '',
    phone: '',
    contactName: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('New client:', formData);
    onOpenChange(false);
    // Reset form
    setFormData({
      companyName: '',
      inn: '',
      phone: '',
      contactName: ''
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={animatedOverlayClassName()} />
        <Dialog.Content className={animatedModalClassName('flex !max-h-[85vh] !w-[calc(100vw-2rem)] !max-w-md flex-col overflow-hidden bg-white dark:bg-gray-800')}>
          <div className="shrink-0">
            <div className="mb-4 flex items-start justify-between gap-4 pr-8">
              <Dialog.Title className="text-xl font-bold text-gray-900 dark:text-white">
                Новый клиент
              </Dialog.Title>
              <Dialog.Close asChild>
                <button className="rounded-full p-1 hover:bg-gray-100 dark:hover:bg-gray-700">
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              Заполните информацию о новом клиенте
            </Dialog.Description>
          </div>

          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              <Input
                label="Наименование"
                placeholder="ООО «Компания»"
                value={formData.companyName}
                onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                required
              />

              <Input
                label="ИНН"
                placeholder="1234567890"
                value={formData.inn}
                onChange={(e) => setFormData({ ...formData, inn: e.target.value })}
                required
              />

              <Input
                label="Телефон"
                placeholder="+7 (999) 123-45-67"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                required
              />

              <Input
                label="Имя"
                placeholder="Иванов Иван Иванович"
                value={formData.contactName}
                onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                required
              />
            </div>

            <div className="mt-4 flex shrink-0 gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
              <Button type="submit" className="flex-1">
                Создать клиента
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
