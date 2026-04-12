import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { usePermissions } from '../lib/permissions';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { ArrowLeft, Camera, X, ImagePlus } from 'lucide-react';
import { EquipmentCombobox } from '../components/ui/EquipmentCombobox';
import { SERVICE_TICKET_KEYS, useCreateServiceTicket } from '../hooks/useServiceTickets';
import { EQUIPMENT_KEYS, useEquipmentList } from '../hooks/useEquipment';
import { RENTAL_KEYS } from '../hooks/useRentals';
import type { EquipmentStatus, ServiceTicket } from '../types';
import { getEquipmentTypeLabel } from '../lib/equipmentClassification';
import { equipmentService } from '../services/equipment.service';
import { rentalsService } from '../services/rentals.service';

export default function ServiceNew() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const createTicket = useCreateServiceTicket();
  const { data: equipmentList = [] } = useEquipmentList();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!can('create', 'service')) navigate('/service', { replace: true });
  }, []);

  const [formData, setFormData] = useState({
    equipmentId: '',
    inventoryNumber: '',
    serialNumber: '',
    location: '',
    priority: 'medium',
    reporterContact: '',
    reason: '',
    description: '',
    notes: '',
  });

  const selectedEquipment = equipmentList.find(e => e.id === formData.equipmentId);

  // ── Photo upload state ──────────────────────────────────────────────────
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoErrors, setPhotoErrors] = useState<string[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const compressToBase64 = (file: File): Promise<string> =>
    new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          const MAX = 800;
          const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
          const canvas = document.createElement('canvas');
          canvas.width  = Math.round(img.width  * ratio);
          canvas.height = Math.round(img.height * ratio);
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        };
        img.src = e.target!.result as string;
      };
      reader.readAsDataURL(file);
    });

  const handlePhotoFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;

    const errors: string[] = [];
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
    const MAX_FILES = 10;

    const valid = files.filter(f => {
      if (!allowed.includes(f.type)) {
        errors.push(`«${f.name}»: неподдерживаемый формат (только JPG, PNG, WEBP)`);
        return false;
      }
      if (f.size > MAX_SIZE) {
        errors.push(`«${f.name}»: файл превышает 10 МБ`);
        return false;
      }
      return true;
    });

    const remaining = MAX_FILES - photos.length;
    if (valid.length > remaining) {
      errors.push(`Можно добавить не более ${MAX_FILES} фото. Добавлено первых ${remaining}.`);
    }

    setPhotoErrors(errors);
    if (!valid.length) return;

    const results = await Promise.all(valid.slice(0, remaining).map(f => compressToBase64(f)));
    setPhotos(prev => [...prev, ...results]);
  };

  const removePhoto = (idx: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== idx));
  };

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
    setSubmitError(null);

    if (!formData.equipmentId) {
      setSubmitError('Выберите технику из списка');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const eq = equipmentList.find(e => e.id === formData.equipmentId);
    if (!eq) {
      setSubmitError('Выбранная техника не найдена — обновите страницу');
      return;
    }
    if (!formData.description && !formData.reason) {
      setSubmitError('Заполните описание проблемы');
      return;
    }

    setIsSubmitting(true);
    const equipmentLabel = eq
      ? `${eq.manufacturer} ${eq.model} (INV: ${eq.inventoryNumber})`
      : 'Не указана';
    const authorName = user?.name || 'Оператор';

    const now = new Date().toISOString();
    const todayStr = now.slice(0, 10);
    const newTicket: Omit<ServiceTicket, 'id'> = {
      equipmentId: formData.equipmentId,
      equipment: equipmentLabel,
      inventoryNumber: eq.inventoryNumber,
      serialNumber: eq.serialNumber,
      equipmentType: eq.type,
      equipmentTypeLabel: getEquipmentTypeLabel(eq),
      location: eq.location,
      reason: formData.reason || formData.description,
      description: formData.description,
      priority: (formData.priority || 'medium') as ServiceTicket['priority'],
      sla: formData.priority === 'critical' ? '4 ч' : formData.priority === 'high' ? '8 ч' : '24 ч',
      assignedTo: undefined,
      assignedMechanicId: undefined,
      assignedMechanicName: undefined,
      createdBy: authorName,
      createdByUserId: user?.id,
      createdByUserName: authorName,
      reporterContact: formData.reporterContact || undefined,
      source: 'manual',
      status: 'new',
      result: undefined,
      resultData: {
        summary: '',
        partsUsed: [],
        worksPerformed: [],
      },
      workLog: [
        {
          date: now,
          text: 'Заявка создана',
          author: authorName,
          type: 'status_change',
        },
      ],
      parts: [],
      createdAt: now,
      ...(photos.length > 0 && { photos }),
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
                author: authorName,
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
      setSubmitError(`Не удалось создать заявку: ${msg}`);
      setIsSubmitting(false);
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
        {/* Global error banner */}
        {submitError && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            <span className="mt-0.5 shrink-0">⚠</span>
            <span>{submitError}</span>
            <button type="button" className="ml-auto shrink-0 opacity-60 hover:opacity-100" onClick={() => setSubmitError(null)}>✕</button>
          </div>
        )}

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
              <EquipmentCombobox
                equipment={equipmentList}
                value={formData.equipmentId}
                valueKey="id"
                onChange={handleEquipmentChange}
              />
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

        {/* Photos block */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-4 w-4" />
              Фото повреждений
              <span className="text-sm font-normal text-gray-400 dark:text-gray-500">(необязательно)</span>
            </CardTitle>
            <CardDescription>Прикрепите фотографии неисправности или повреждений</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Hidden file input */}
            <input
              ref={photoInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={handlePhotoFilePick}
            />

            {/* Upload zone */}
            {photos.length < 10 && (
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-6 text-center transition-colors hover:border-[--color-primary] hover:bg-gray-50 dark:border-gray-600 dark:hover:border-[--color-primary] dark:hover:bg-gray-800/40"
              >
                <ImagePlus className="h-8 w-8 text-gray-400 dark:text-gray-500" />
                <div>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Нажмите для выбора фото
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                    JPG, PNG, WEBP · до 10 МБ каждый · максимум 10 файлов
                  </p>
                </div>
              </button>
            )}

            {/* Error messages */}
            {photoErrors.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/20">
                {photoErrors.map((err, i) => (
                  <p key={i} className="text-xs text-red-600 dark:text-red-400">{err}</p>
                ))}
              </div>
            )}

            {/* Photo previews */}
            {photos.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Выбрано фото: {photos.length} / 10
                  </span>
                  <button
                    type="button"
                    onClick={() => { setPhotos([]); setPhotoErrors([]); }}
                    className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                  >
                    Очистить всё
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                  {photos.map((src, i) => (
                    <div key={i} className="group relative aspect-square overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
                      <img
                        src={src}
                        alt={`Фото ${i + 1}`}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-600"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {photos.length < 10 && (
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      className="flex aspect-square items-center justify-center rounded-md border-2 border-dashed border-gray-300 text-gray-400 transition-colors hover:border-[--color-primary] hover:text-[--color-primary] dark:border-gray-600"
                    >
                      <ImagePlus className="h-5 w-5" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Assignment block */}
        <Card>
          <CardHeader>
            <CardTitle>Заявитель</CardTitle>
            <CardDescription>Автор заявки и контактное лицо по проблеме</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Автор заявки
              </label>
              <Input
                value={user?.name || 'Оператор'}
                readOnly
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Это пользователь системы, который фактически создаёт заявку.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Контактное лицо
              </label>
              <Input
                placeholder="Например: Сергей, +7 939 365-32-09"
                value={formData.reporterContact}
                onChange={(e) => setFormData({ ...formData, reporterContact: e.target.value })}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Кто сообщил о проблеме и как с ним связаться для уточнений.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Создаём заявку…' : 'Создать заявку'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/service')}>
            Отмена
          </Button>
        </div>
      </form>
    </div>
  );
}
