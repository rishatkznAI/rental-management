import React, { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { EQUIPMENT_KEYS } from '../../hooks/useEquipment';
import { RENTAL_KEYS } from '../../hooks/useRentals';
import { SERVICE_TICKET_KEYS, useCreateServiceTicket } from '../../hooks/useServiceTickets';
import { getEquipmentTypeLabel } from '../../lib/equipmentClassification';
import type { Equipment, EquipmentSalePdiStatus, ServiceTicket } from '../../types';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

type PdiResult = 'ready_for_sale' | 'ready_for_rent' | 'needs_rework' | 'needs_repair' | 'hold_sale';

type PdiFormProps = {
  equipment: Equipment;
  onCancel: () => void;
  onCreated?: (ticket: ServiceTicket, status: EquipmentSalePdiStatus) => void | Promise<void>;
  stickyActions?: boolean;
};

const CHECK_LABELS = {
  exterior: 'Внешний осмотр',
  hydraulics: 'Гидравлика',
  electrics: 'Электрика',
  battery: 'АКБ / зарядка',
  engine: 'Двигатель',
  controls: 'Пульты управления',
  emergencyButtons: 'Аварийные кнопки',
  wheels: 'Колёса / шины',
  platform: 'Платформа / ограждения',
  leaks: 'Утечки',
  noises: 'Шумы / ошибки',
  hours: 'Моточасы',
  completeness: 'Комплектация',
  factoryDefects: 'Заводские дефекты',
} as const;

const DOCUMENT_LABELS = {
  passport: 'Паспорт',
  certificates: 'Сертификаты',
  manual: 'Инструкция',
  warranty: 'Гарантийные документы',
  customs: 'Таможенные / поставочные документы',
} as const;

const PHOTO_LABELS = {
  fourSides: 'Фото с 4 сторон',
  serialPlate: 'Шильдик / серийный номер',
  controls: 'Пульты управления',
  platform: 'Платформа',
  technicalBay: 'Подкапотное / технический отсек',
  defects: 'Дефекты',
} as const;

const PDI_RESULT_LABELS: Record<PdiResult, string> = {
  ready_for_sale: 'Готова к продаже',
  ready_for_rent: 'Готова к аренде',
  needs_rework: 'Нужна доработка',
  needs_repair: 'Нужен ремонт до продажи',
  hold_sale: 'Не продавать до решения проблемы',
};

const today = () => new Date().toISOString().slice(0, 10);

function makeInitialFlags<T extends Record<string, string>>(labels: T): Record<keyof T, boolean> {
  return Object.fromEntries(Object.keys(labels).map(key => [key, false])) as Record<keyof T, boolean>;
}

function statusFromResult(result: PdiResult, current: EquipmentSalePdiStatus): EquipmentSalePdiStatus {
  if (result === 'ready_for_sale') return 'ready';
  if (result === 'ready_for_rent') return 'ready_for_rent';
  if (result === 'hold_sale' || result === 'needs_repair') return 'issues';
  return current === 'not_started' ? 'in_progress' : current;
}

function pdiSuccessMessage(status: EquipmentSalePdiStatus): string {
  if (status === 'ready_for_rent') return 'PDI сохранён: техника готова к аренде';
  if (status === 'ready') return 'PDI сохранён: техника готова к продаже';
  return 'PDI сохранён';
}

export function PdiForm({ equipment, onCancel, onCreated, stickyActions = false }: PdiFormProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const createTicket = useCreateServiceTicket();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [photoErrors, setPhotoErrors] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [checks, setChecks] = useState(() => makeInitialFlags(CHECK_LABELS));
  const [documents, setDocuments] = useState(() => makeInitialFlags(DOCUMENT_LABELS));
  const [photoChecklist, setPhotoChecklist] = useState(() => makeInitialFlags(PHOTO_LABELS));
  const [formData, setFormData] = useState({
    pdiStatus: (equipment.salePdiStatus ?? 'not_started') as EquipmentSalePdiStatus,
    responsible: user?.name || '',
    inspectionDate: today(),
    readinessDeadline: '',
    comment: '',
    documentsReady: 'not_ready',
    result: 'needs_rework' as PdiResult,
  });

  const isDiesel = useMemo(() => equipment.drive === 'diesel', [equipment.drive]);
  const visibleChecks = useMemo(
    () => Object.entries(CHECK_LABELS).filter(([key]) => isDiesel || key !== 'engine'),
    [isDiesel],
  );

  const toggleFlag = <T extends string>(
    setter: React.Dispatch<React.SetStateAction<Record<T, boolean>>>,
    key: T,
  ) => setter(prev => ({ ...prev, [key]: !prev[key] }));

  const compressToBase64 = (file: File): Promise<string> =>
    new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          const max = 800;
          const ratio = Math.min(max / img.width, max / img.height, 1);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * ratio);
          canvas.height = Math.round(img.height * ratio);
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        };
        img.src = e.target!.result as string;
      };
      reader.readAsDataURL(file);
    });

  const handlePhotoFilePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;

    const errors: string[] = [];
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const maxSize = 10 * 1024 * 1024;
    const maxFiles = 12;
    const valid = files.filter(file => {
      if (!allowed.includes(file.type)) {
        errors.push(`«${file.name}»: неподдерживаемый формат`);
        return false;
      }
      if (file.size > maxSize) {
        errors.push(`«${file.name}»: файл превышает 10 МБ`);
        return false;
      }
      return true;
    });

    const remaining = maxFiles - photos.length;
    if (valid.length > remaining) errors.push(`Можно добавить не более ${maxFiles} фото.`);
    setPhotoErrors(errors);
    if (!valid.length || remaining <= 0) return;

    const results = await Promise.all(valid.slice(0, remaining).map(file => compressToBase64(file)));
    setPhotos(prev => [...prev, ...results]);
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError(null);

    if (!formData.responsible.trim()) {
      setSubmitError('Укажите ответственного за PDI');
      return;
    }
    if (!formData.inspectionDate) {
      setSubmitError('Укажите дату проверки');
      return;
    }

    setIsSubmitting(true);
    const authorName = user?.name || 'Оператор';
    const now = new Date().toISOString();
    const nextStatus = statusFromResult(formData.result, formData.pdiStatus);
    const equipmentLabel = `${equipment.manufacturer} ${equipment.model} (INV: ${equipment.inventoryNumber})`;
    const checkedLabels = visibleChecks
      .filter(([key]) => checks[key as keyof typeof checks])
      .map(([, label]) => label);
    const description = [
      `Статус PDI: ${formData.pdiStatus}`,
      `Результат: ${PDI_RESULT_LABELS[formData.result]}`,
      `Ответственный: ${formData.responsible}`,
      formData.readinessDeadline ? `Дедлайн готовности: ${formData.readinessDeadline}` : '',
      checkedLabels.length ? `Проверено: ${checkedLabels.join(', ')}` : '',
      formData.comment.trim() ? `Комментарий: ${formData.comment.trim()}` : '',
    ].filter(Boolean).join('\n');

    const pdiData = {
      status: formData.pdiStatus,
      nextStatus,
      responsible: formData.responsible.trim(),
      inspectionDate: formData.inspectionDate,
      readinessDeadline: formData.readinessDeadline || undefined,
      comment: formData.comment.trim(),
      checks,
      documents: {
        ...documents,
        readiness: formData.documentsReady,
      },
      photos: photoChecklist,
      result: formData.result,
      resultLabel: PDI_RESULT_LABELS[formData.result],
    };

    const newTicket = {
      equipmentId: equipment.id,
      serviceKind: 'repair',
      type: 'pdi',
      scenario: 'pdi',
      source: 'sales',
      saleMode: true,
      pdiData,
      equipment: equipmentLabel,
      inventoryNumber: equipment.inventoryNumber,
      serialNumber: equipment.serialNumber,
      equipmentType: equipment.type,
      equipmentTypeLabel: getEquipmentTypeLabel(equipment),
      location: equipment.location,
      reason: 'PDI / предпродажная подготовка',
      description,
      priority: 'low',
      sla: '',
      assignedTo: formData.responsible.trim(),
      createdBy: authorName,
      createdByUserId: user?.id,
      createdByUserName: authorName,
      status: nextStatus === 'ready' ? 'ready' : 'in_progress',
      result: PDI_RESULT_LABELS[formData.result],
      resultData: {
        summary: description,
        partsUsed: [],
        worksPerformed: [],
      },
      workLog: [
        {
          date: now,
          text: 'PDI / предпродажная подготовка создана',
          author: authorName,
          type: 'status_change',
        },
      ],
      parts: [],
      createdAt: now,
      ...(photos.length > 0 && { photos }),
    } as Omit<ServiceTicket, 'id'>;

    try {
      const createdTicket = await createTicket.mutateAsync(newTicket);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SERVICE_TICKET_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: SERVICE_TICKET_KEYS.byEquipment(equipment.id) }),
        queryClient.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt }),
      ]);
      await onCreated?.(createdTicket, nextStatus);
      toast.success(pdiSuccessMessage(nextStatus));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
      setSubmitError(`Не удалось сохранить PDI: ${message}`);
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {submitError && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          <span>{submitError}</span>
          <button type="button" className="ml-auto opacity-60 hover:opacity-100" onClick={() => setSubmitError(null)}>X</button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Техника на продаже</CardTitle>
          <CardDescription>Предпродажная подготовка фиксируется отдельно от сервисной очереди.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60 md:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Техника</p>
            <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{equipment.manufacturer} {equipment.model}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Инвентарный номер</p>
            <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{equipment.inventoryNumber}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Серийный номер</p>
            <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{equipment.serialNumber || 'Не указан'}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Локация</p>
            <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{equipment.location || 'Не указана'}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Основные поля PDI</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Статус PDI</label>
            <Select value={formData.pdiStatus} onValueChange={(value) => setFormData(prev => ({ ...prev, pdiStatus: value as EquipmentSalePdiStatus }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="not_started">Не начат</SelectItem>
                <SelectItem value="in_progress">В работе</SelectItem>
                <SelectItem value="issues">Есть замечания</SelectItem>
                <SelectItem value="ready">Готов к продаже</SelectItem>
                <SelectItem value="ready_for_rent">Готов к аренде</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Ответственный</label>
            <Input value={formData.responsible} onChange={(event) => setFormData(prev => ({ ...prev, responsible: event.target.value }))} required />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Дата проверки</label>
            <Input type="date" value={formData.inspectionDate} onChange={(event) => setFormData(prev => ({ ...prev, inspectionDate: event.target.value }))} required />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Дедлайн готовности</label>
            <Input type="date" value={formData.readinessDeadline} onChange={(event) => setFormData(prev => ({ ...prev, readinessDeadline: event.target.value }))} />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Комментарий</label>
            <textarea
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              rows={3}
              value={formData.comment}
              onChange={(event) => setFormData(prev => ({ ...prev, comment: event.target.value }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Проверка техники</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleChecks.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
              <input type="checkbox" checked={checks[key as keyof typeof checks]} onChange={() => toggleFlag(setChecks, key as keyof typeof checks)} />
              <span>{label}</span>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Документы</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(DOCUMENT_LABELS).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                <input type="checkbox" checked={documents[key as keyof typeof documents]} onChange={() => toggleFlag(setDocuments, key as keyof typeof documents)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Готовность документов</label>
            <Select value={formData.documentsReady} onValueChange={(value) => setFormData(prev => ({ ...prev, documentsReady: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ready">Документы готовы</SelectItem>
                <SelectItem value="not_ready">Документы не готовы</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Camera className="h-4 w-4" /> Фото</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(PHOTO_LABELS).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                <input type="checkbox" checked={photoChecklist[key as keyof typeof photoChecklist]} onChange={() => toggleFlag(setPhotoChecklist, key as keyof typeof photoChecklist)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <input ref={photoInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handlePhotoFilePick} />
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-4 py-5 text-center transition-colors hover:border-[--color-primary] hover:bg-gray-50 dark:border-gray-600 dark:hover:border-[--color-primary] dark:hover:bg-gray-800/40"
          >
            <ImagePlus className="h-7 w-7 text-gray-400 dark:text-gray-500" />
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Добавить фото PDI</span>
          </button>
          {photoErrors.map(error => <p key={error} className="text-xs text-red-600 dark:text-red-400">{error}</p>)}
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {photos.map((src, index) => (
                <div key={index} className="group relative aspect-square overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
                  <img src={src} alt={`Фото PDI ${index + 1}`} className="h-full w-full object-cover" />
                  <button type="button" onClick={() => removePhoto(index)} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Результат</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Итог предпродажной подготовки</label>
          <Select value={formData.result} onValueChange={(value) => setFormData(prev => ({ ...prev, result: value as PdiResult }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(PDI_RESULT_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className={stickyActions ? 'sticky bottom-0 z-10 flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur sm:flex-row dark:border-gray-800 dark:bg-gray-950/95' : 'flex gap-3'}>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Сохраняем PDI...' : 'Сохранить PDI'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>Отмена</Button>
      </div>
    </form>
  );
}
