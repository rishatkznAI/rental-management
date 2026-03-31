import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { ArrowLeft } from 'lucide-react';
import { loadRentals, saveRentals } from '../mock-data';

export default function RentalNew() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    client: '',
    equipment: '',
    startDate: '',
    plannedReturnDate: '',
    price: '',
    deposit: '',
    notes: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const existing = loadRentals();
    const newRental = {
      id: `r-${Date.now()}`,
      client: formData.client,
      contact: '',
      startDate: formData.startDate,
      plannedReturnDate: formData.plannedReturnDate,
      equipment: [formData.equipment].filter(Boolean),
      rate: `${formData.price} ₽/день`,
      price: Number(formData.price) || 0,
      discount: 0,
      deliveryAddress: '',
      manager: '',
      status: 'new' as const,
      comments: formData.notes,
    };
    saveRentals([...existing, newRental]);
    navigate('/rentals');
  };

  return (
    <div className="space-y-6 p-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="secondary" onClick={() => navigate('/rentals')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Новая аренда</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Создание договора аренды</p>
        </div>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle>Основная информация</CardTitle>
          <CardDescription>Заполните данные о договоре аренды</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Select
              label="Клиент"
              placeholder="Выберите клиента"
              value={formData.client}
              onValueChange={(value) => setFormData({ ...formData, client: value })}
              options={[
                { value: 'client1', label: 'ООО «СтройМонтаж»' },
                { value: 'client2', label: 'ПАО «МосСтрой»' },
                { value: 'client3', label: 'ИП Иванов А.С.' }
              ]}
            />

            <Select
              label="Техника"
              placeholder="Выберите технику"
              value={formData.equipment}
              onValueChange={(value) => setFormData({ ...formData, equipment: value })}
              options={[
                { value: 'eq1', label: 'Genie Z-80/60 (#SN12345)' },
                { value: 'eq2', label: 'JLG 600S (#SN67890)' },
                { value: 'eq3', label: 'Haulotte HA16 PX (#SN11223)' }
              ]}
            />

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Дата начала"
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                required
              />

              <Input
                label="Плановая дата возврата"
                type="date"
                value={formData.plannedReturnDate}
                onChange={(e) => setFormData({ ...formData, plannedReturnDate: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Стоимость (₽/день)"
                type="number"
                placeholder="0"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                required
              />

              <Input
                label="Залог (₽)"
                type="number"
                placeholder="0"
                value={formData.deposit}
                onChange={(e) => setFormData({ ...formData, deposit: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Примечания
              </label>
              <textarea
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                rows={3}
                placeholder="Дополнительная информация о договоре"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="submit">
                Создать договор
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate('/rentals')}
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
