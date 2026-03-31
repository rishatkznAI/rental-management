import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

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
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white dark:bg-gray-800 p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-gray-900 dark:text-white">
              Новый клиент
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-full p-1 hover:bg-gray-100 dark:hover:bg-gray-700">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Заполните информацию о новом клиенте
          </Dialog.Description>

          <form onSubmit={handleSubmit} className="space-y-4">
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

            <div className="flex gap-3 pt-4">
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