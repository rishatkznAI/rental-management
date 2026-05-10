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
        <Dialog.Content className={animatedModalClassName('flex !max-h-[85vh] !w-[calc(100vw-2rem)] !max-w-md flex-col overflow-hidden border-slate-200/90 bg-white p-0 dark:border-gray-800 dark:bg-gray-950')}>
          <div className="shrink-0 border-b border-slate-100 px-6 py-5 pr-14 dark:border-gray-800">
            <div className="flex items-start justify-between gap-4">
              <Dialog.Title className="text-xl font-semibold text-slate-950 dark:text-white">
                Новый клиент
              </Dialog.Title>
              <Dialog.Close asChild>
                <button className="absolute right-4 top-4 inline-flex size-9 items-center justify-center rounded-xl border border-transparent text-slate-400 transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700 dark:text-gray-500 dark:hover:border-gray-800 dark:hover:bg-gray-900 dark:hover:text-gray-200">
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="mt-2 text-sm leading-6 text-slate-500 dark:text-gray-400">
              Заполните информацию о новом клиенте
            </Dialog.Description>
          </div>

          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5 pr-5">
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

            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 px-6 py-4 sm:flex-row dark:border-gray-800 dark:bg-gray-950/95">
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
