import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { usePermissions } from '../lib/permissions';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { ArrowLeft } from 'lucide-react';
import { SERVICE_TICKET_KEYS, useCreateServiceTicket } from '../hooks/useServiceTickets';
import { EQUIPMENT_KEYS, useEquipmentList } from '../hooks/useEquipment';
import { RENTAL_KEYS } from '../hooks/useRentals';
import type { EquipmentStatus, ServiceTicket } from '../types';
import { equipmentService } from '../services/equipment.service';
import { rentalsService } from '../services/rentals.service';

export default function ServiceNew() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const createTicket = useCreateServiceTicket();
  const { data: equipmentList = [] } = useEquipmentList();

  useEffect(() => {
    if (!can('create', 'service')) navigate('/service', { replace: true });
  }, []);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.equipmentId) return;
    const eq = equipmentList.find(e => e.id === formData.equipmentId);
    if (!eq) return;
    const equipmentLabel = eq
      ? `${eq.manufacturer} ${eq.model} (INV: ${eq.inventoryNumber})`
      : 'Не указана';

    const now = new Date().toISOString();
    const todayStr = now.slice(0, 10);
    const newTicket: Omit<ServiceTicket, 'id'> = {
      equipmentId: formData.equipmentId,
      equipment: equipmentLabel,
      inventoryNumber: eq.inventoryNumber,
      serialNumber: eq.serialNumber,
      equipmentType: eq.type,
      location: eq.location,
      reason: formData.reason || formData.description,
      description: formData.description,
      priority: (formData.priority || 'medium') as ServiceTicket['priority'],
      sla: formData.priority === 'critical' ? '4 ч' : formData.priority === 'high' ? '8 ч' : '24 ч',
      assignedTo: formData.assignedTo || undefined,
      createdBy: formData.contact || 'Оператор',
      source: 'manual',
      status: 'new',
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
    try {
      const createdTicket = await createTicket.mutateAsync(newTicket);

      const [allEquipment, allGanttRentals] = await Promise.all([
        equipmentService.getAll(),
        rentalsService.getGanttData(),
      ]);

      const updatedEquipment = allEquipment.map(item =>
        item.id === eq.id
          ? { ...item, status: 'in_service' as EquipmentStatus, currentClient: undefined, returnDate: undefined }
          : item,
      );

      const updatedGanttRentals = allGanttRentals.map(rental => {
        if (
          rental.equipmentInv === eq.inventoryNumber
          && rental.status === 'active'
          && rental.startDate <= todayStr
          && rental.endDate >= todayStr
        ) {
          return {
            ...rental,
            endDate: todayStr,
            status: 'returned' as const,
            comments: [
              ...(rental.comments ?? []),
              {
                date: now,
                text: `Аренда остановлена из-за сервисной заявки ${createdTicket.id}`,
                author: formData.contact || 'Оператор',
              },
            ],
          };
        }
        return rental;
      });

      await Promise.all([
        equipmentService.bulkReplace(updatedEquipment),
        rentalsService.bulkReplaceGantt(updatedGanttRentals),
      ]);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SERVICE_TICKET_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt }),
      ]);

      navigate(`/service/${createdTicket.id}`);
    } catch {
      // Ошибку мутации покажет стандартный flow страницы/хука
    }
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
            <CardDescription>Выберите технику из базы системы, по которой создаётся заявка</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Техника из системы
              </label>
              <select
                value={formData.equipmentId}
                onChange={(e) => handleEquipmentChange(e.target.value)}
                required
                className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="">Выберите технику</option>
                {equipmentList.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.manufacturer} {e.model} · INV {e.inventoryNumber}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                В заявке можно выбрать только ту технику, которая уже заведена в системе.
              </p>
            </div>

            {selectedEquipment ? (
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60 md:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Инвентарный номер</p>
                  <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{selectedEquipment.inventoryNumber}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Серийный номер</p>
                  <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{selectedEquipment.serialNumber || 'Не указан'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Системная локация</p>
                  <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{selectedEquipment.location || 'Не указана'}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                Сначала выберите технику из списка, после этого ниже автоматически подтянутся её данные.
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Местоположение техники сейчас
              </label>
              <Input
                placeholder="Например: объект клиента, склад, адрес площадки"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                required
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Укажите, где техника находится фактически в момент поломки, если это важно для выезда сервиса.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Problem block */}
        <Card>
          <CardHeader>
            <CardTitle>Проблема</CardTitle>
            <CardDescription>Укажите срочность и опишите неисправность</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Приоритет заявки
              </label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="low">Низкий</option>
                <option value="medium">Средний</option>
                <option value="high">Высокий</option>
                <option value="critical">Критический</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Укажите, насколько срочно сервису нужно отреагировать на эту проблему.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Что не работает
              </label>
              <Input
                placeholder="Например: Не реагирует на команды, не поднимается, ошибка на дисплее"
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                required
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Кратко опишите основную проблему одной фразой.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Описание неисправности
              </label>
              <textarea
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                rows={3}
                placeholder="Что произошло, когда появилась неисправность, есть ли ошибка на панели, работает ли техника частично, какие действия уже пробовали..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                Здесь лучше описать симптомы подробнее: когда возникла проблема, что видно/слышно, есть ли код ошибки и в каких условиях это произошло.
              </p>
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
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Контакт заявителя
              </label>
              <Input
                placeholder="Например: Сергей, +7 939 365-32-09"
                value={formData.contact}
                onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Кто сообщил о проблеме и как с ним связаться для уточнений.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Ответственный исполнитель
              </label>
              <Input
                placeholder="Например: Иванов Механик"
                value={formData.assignedTo}
                onChange={(e) => setFormData({ ...formData, assignedTo: e.target.value })}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Укажите механика или сотрудника сервиса, который будет заниматься заявкой.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={!formData.equipmentId}>
            Создать заявку
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/service')}>
            Отмена
          </Button>
        </div>
      </form>
    </div>
  );
}
