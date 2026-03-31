import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { ArrowLeft } from 'lucide-react';
import { loadClients, saveClients } from '../mock-data';

export default function ClientNew() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    companyName: '',
    inn: '',
    phone: '',
    contactName: '',
    email: '',
    address: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const existing = loadClients();
    const newClient = {
      id: `c-${Date.now()}`,
      company: formData.companyName,
      inn: formData.inn,
      contact: formData.contactName,
      phone: formData.phone,
      email: formData.email,
      paymentTerms: 'Постоплата 14 дней',
      creditLimit: 0,
      debt: 0,
      totalRentals: 0,
    };
    saveClients([...existing, newClient]);
    navigate('/clients');
  };

  return (
    <div className="space-y-6 p-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="secondary" onClick={() => navigate('/clients')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Новый клиент</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Добавление нового клиента в систему</p>
        </div>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle>Информация о клиенте</CardTitle>
          <CardDescription>Заполните основные данные</CardDescription>
        </CardHeader>
        <CardContent>
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

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Телефон"
                placeholder="+7 (999) 123-45-67"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                required
              />

              <Input
                label="Email"
                placeholder="info@company.ru"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>

            <Input
              label="Имя контактного лица"
              placeholder="Иванов Иван Иванович"
              value={formData.contactName}
              onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
              required
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Адрес
              </label>
              <textarea
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                rows={2}
                placeholder="Юридический адрес"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="submit">
                Создать клиента
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate('/clients')}
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
