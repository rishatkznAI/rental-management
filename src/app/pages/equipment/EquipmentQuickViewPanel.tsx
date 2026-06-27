import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Boxes, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { AuthenticatedImage } from '../../components/ui/AuthenticatedImage';
import { normalizePhotoReference } from '../../lib/media';
import type { Equipment as EquipmentEntity } from '../../types';
import { EQUIPMENT_PREVIEW_TABS, EQUIPMENT_QUICK_VIEW_EMPTY_COPY } from './equipment.constants';
import type {
  EquipmentPreviewDocument,
  EquipmentPreviewDocumentSlot,
  EquipmentPreviewField,
  EquipmentPreviewPhoto,
  EquipmentPreviewTab,
  EquipmentPreviewTimelineItem,
  EquipmentQuickViewPanelData,
} from './equipment.types';
import { EquipmentQuickActions } from './EquipmentQuickActions';

export type {
  EquipmentPreviewDocument,
  EquipmentPreviewDocumentSlot,
  EquipmentPreviewField,
  EquipmentPreviewPhoto,
  EquipmentPreviewTab,
  EquipmentPreviewTimelineItem,
  EquipmentQuickViewPanelData,
} from './equipment.types';

type EquipmentQuickViewPanelProps = EquipmentQuickViewPanelData & {
  selectedEquipment: EquipmentEntity | null;
  activeTab: EquipmentPreviewTab;
  onTabChange: (tab: EquipmentPreviewTab) => void;
  onClose: () => void;
  mode?: 'overlay' | 'embedded';
};

function PreviewField({ label, value }: EquipmentPreviewField) {
  return (
    <div className="min-w-0 rounded-lg border border-border/75 bg-secondary/45 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/58">{label}</div>
      <div className="mt-1.5 truncate text-sm font-semibold text-foreground">{value || '—'}</div>
    </div>
  );
}

function PreviewEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-secondary/35 p-4 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function buildGsmFields(selectedEquipment: EquipmentEntity): EquipmentPreviewField[] {
  const latitude = selectedEquipment.gsmLastLat ?? selectedEquipment.gsmLatitude;
  const longitude = selectedEquipment.gsmLastLng ?? selectedEquipment.gsmLongitude;
  return [
    { label: 'Статус', value: selectedEquipment.gsmStatus || selectedEquipment.gsmSignalStatus || '—' },
    { label: 'IMEI', value: selectedEquipment.gsmImei || '—' },
    { label: 'Устройство', value: selectedEquipment.gsmDeviceId || selectedEquipment.gsmTrackerId || '—' },
    { label: 'Последний сигнал', value: selectedEquipment.gsmLastSeenAt || selectedEquipment.gsmLastSignalAt || '—' },
    { label: 'Адрес', value: selectedEquipment.gsmAddress || '—' },
    { label: 'Координаты', value: latitude && longitude ? `${latitude}, ${longitude}` : '—' },
    { label: 'Моточасы GSM', value: selectedEquipment.gsmLastMotoHours || selectedEquipment.gsmHourmeter || '—' },
    { label: 'Напряжение', value: selectedEquipment.gsmLastVoltage || selectedEquipment.gsmBatteryVoltage || '—' },
  ];
}

export function EquipmentQuickViewPanel({
  selectedEquipment,
  activeTab,
  onTabChange,
  onClose,
  title,
  detailPath,
  mainPhoto,
  statusLabel,
  statusClassName,
  readinessBadge,
  inventoryNumber,
  serialNumber,
  quickActions,
  overviewFields,
  specFields,
  canViewDocuments,
  documentSlots,
  documents,
  docsPath,
  timeline,
  mode = 'overlay',
}: EquipmentQuickViewPanelProps) {
  if (!selectedEquipment) return null;

  const content = (
    <aside
      data-testid="equipment-quick-view-panel"
      className={mode === 'embedded'
        ? 'pointer-events-auto flex max-h-[calc(100vh-2rem)] min-h-[560px] w-full min-w-0 max-w-full flex-col overflow-hidden rounded-2xl border border-border/90 bg-card/92 shadow-[0_18px_42px_-36px_rgba(15,23,42,0.9)] xl:min-w-[360px] xl:max-w-[430px]'
        : 'fixed inset-x-0 bottom-0 z-50 flex max-h-[82vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border/90 bg-background shadow-2xl xl:hidden'
      }
    >
      <div className="border-b border-border/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {mainPhoto ? (
              <AuthenticatedImage
                photo={normalizePhotoReference(mainPhoto, { idPrefix: `${selectedEquipment.id}-quick-thumb` })}
                alt={title}
                className="h-14 w-16 shrink-0 rounded-lg border border-border/90 shadow-sm"
                imgClassName="h-full w-full object-cover"
                fallbackClassName="h-14 w-16"
              />
            ) : (
              <div className="flex h-14 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-border/90 bg-secondary/60 text-foreground/55">
                <Boxes className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="app-shell-title truncate text-lg font-extrabold text-foreground">{title}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusClassName}`}>
                  {statusLabel}
                </span>
                {readinessBadge ? (
                  <span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-medium ${readinessBadge.className}`}>
                    {readinessBadge.label}
                  </span>
                ) : null}
                <span className="inline-flex max-w-full rounded-full border border-border/70 bg-secondary/75 px-2.5 py-1 font-mono text-xs text-foreground/66">
                  <span className="truncate">INV {inventoryNumber || '—'}</span>
                </span>
                <span className="inline-flex max-w-full rounded-full border border-border/70 bg-secondary/75 px-2.5 py-1 font-mono text-xs text-foreground/66">
                  <span className="truncate">SN {serialNumber || 'не указан'}</span>
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground/62 transition hover:bg-secondary hover:text-foreground"
            aria-label="Закрыть панель техники"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border/80 bg-card/62 px-4 py-2">
        {EQUIPMENT_PREVIEW_TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            className="app-filter-chip whitespace-nowrap rounded-lg px-3 py-1.5 text-xs"
            data-active={String(activeTab === tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <EquipmentQuickActions actions={quickActions} />

        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 gap-3">
            {overviewFields.map(field => (
              <PreviewField key={field.label} label={field.label} value={field.value} />
            ))}
          </div>
        )}

        {activeTab === 'specs' && (
          <div className="grid grid-cols-1 gap-3">
            {specFields.map(field => (
              <PreviewField key={field.label} label={field.label} value={field.value} />
            ))}
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="space-y-4">
            {!canViewDocuments ? (
              <PreviewEmpty>{EQUIPMENT_QUICK_VIEW_EMPTY_COPY.noDocumentsAccess}</PreviewEmpty>
            ) : (
              <>
                <div className="grid gap-2">
                  {documentSlots.map(slot => (
                    <div key={slot.label} className="flex items-center justify-between rounded-lg border border-border/70 bg-secondary/48 px-3 py-2 text-sm">
                      <span className="font-medium text-foreground">{slot.label}</span>
                      <span className={slot.count > 0 ? 'text-emerald-300' : 'text-foreground/58'}>
                        {slot.count > 0 ? `${slot.count} шт.` : 'Не найдено'}
                      </span>
                    </div>
                  ))}
                </div>
                {documents.length > 0 ? (
                  <div className="space-y-2">
                    {documents.slice(0, 8).map(document => (
                      <div key={document.id} className="rounded-lg border border-border/80 bg-secondary/25 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-foreground">{document.typeLabel}</div>
                            <div className="mt-1 truncate font-mono text-xs text-foreground/58">{document.number}</div>
                          </div>
                          <span className="shrink-0 text-xs text-foreground/58">{document.dateLabel}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <PreviewEmpty>{EQUIPMENT_QUICK_VIEW_EMPTY_COPY.noDocuments}</PreviewEmpty>
                )}
                <Link to={docsPath}>
                  <Button className="w-full" variant="outline">Показать все документы</Button>
                </Link>
              </>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-3">
            {timeline.length > 0 ? timeline.map(item => (
              <div key={item.id} className="rounded-lg border border-border/80 bg-secondary/25 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{item.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-foreground/58">{item.description}</div>
                  </div>
                  <span className="shrink-0 text-xs text-foreground/58">{item.dateLabel}</span>
                </div>
              </div>
            )) : (
              <PreviewEmpty>{EQUIPMENT_QUICK_VIEW_EMPTY_COPY.noHistory}</PreviewEmpty>
            )}
          </div>
        )}

        {activeTab === 'gsm' && (
          <div className="grid grid-cols-1 gap-3">
            {buildGsmFields(selectedEquipment).map(field => (
              <PreviewField key={field.label} label={field.label} value={field.value} />
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-border/85 bg-card/65 p-4">
        <Link to={`${detailPath}?action=edit`} className="min-w-0 flex-1">
          <Button className="w-full" variant="outline">Редактировать</Button>
        </Link>
        <Link to={detailPath} className="min-w-0 flex-1">
          <Button className="w-full">Действия</Button>
        </Link>
      </div>
    </aside>
  );

  if (mode === 'embedded') return content;

  const overlay = (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/35"
        aria-label="Закрыть быстрый просмотр"
        onClick={onClose}
      />
      {content}
    </>
  );

  return typeof document === 'undefined' ? overlay : createPortal(overlay, document.body);
}
