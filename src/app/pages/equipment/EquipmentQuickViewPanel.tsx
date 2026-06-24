import type { ReactNode } from 'react';
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

type EquipmentQuickViewPanelProps = Partial<EquipmentQuickViewPanelData> & {
  selectedEquipment: EquipmentEntity | null;
  activeTab: EquipmentPreviewTab;
  onTabChange: (tab: EquipmentPreviewTab) => void;
  onClose: () => void;
  mode?: 'drawer' | 'inline';
};

function PreviewField({ label, value }: EquipmentPreviewField) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-slate-900">{value || '—'}</div>
    </div>
  );
}

function PreviewEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
      {children}
    </div>
  );
}

function EquipmentDetailEmpty() {
  return (
    <aside className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center" data-testid="equipment-detail-empty">
      <Boxes className="h-8 w-8 text-slate-400" />
      <h2 className="mt-3 text-base font-semibold text-slate-900">Выберите технику из списка</h2>
      <p className="mt-1 max-w-[260px] text-sm text-slate-500">Здесь появятся статус, локация, GSM, документы и быстрые действия по выбранной единице.</p>
    </aside>
  );
}

export function EquipmentQuickViewPanel({
  selectedEquipment,
  activeTab,
  onTabChange,
  onClose,
  title = 'Без модели',
  detailPath = '#',
  mainPhoto,
  statusLabel = 'Не указан',
  statusClassName = 'app-status-default',
  inventoryNumber,
  serialNumber,
  quickActions = [],
  overviewFields = [],
  specFields = [],
  canViewDocuments = false,
  documentSlots = [],
  documents = [],
  docsPath = '/documents',
  canViewPhotos = false,
  photos = [],
  timeline = [],
  mode = 'drawer',
}: EquipmentQuickViewPanelProps) {
  if (!selectedEquipment) return <EquipmentDetailEmpty />;

  const panel = (
    <aside
      className={mode === 'inline'
        ? 'flex max-h-[calc(100vh-156px)] min-h-[640px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_42px_-34px_rgba(15,23,42,0.55)]'
        : 'fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col border-l border-border bg-background shadow-2xl'}
      data-testid="equipment-detail-panel"
    >
      <div className="border-b border-slate-200 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="app-shell-title truncate text-xl font-extrabold text-foreground">{title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusClassName}`}>
                {statusLabel}
              </span>
              <span className="inline-flex max-w-full rounded-full bg-slate-100 px-2.5 py-1 font-mono text-xs text-slate-500">
                <span className="truncate">INV {inventoryNumber || '—'}</span>
              </span>
              <span className="inline-flex max-w-full rounded-full bg-slate-100 px-2.5 py-1 font-mono text-xs text-slate-500">
                <span className="truncate">SN {serialNumber || 'не указан'}</span>
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            aria-label="Закрыть панель техники"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-4 py-2">
        {EQUIPMENT_PREVIEW_TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            className="app-filter-chip whitespace-nowrap"
            data-active={String(activeTab === tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <EquipmentQuickActions actions={quickActions} />

        {activeTab === 'overview' && (
          <div className="space-y-4">
            {mainPhoto ? (
              <AuthenticatedImage
                photo={normalizePhotoReference(mainPhoto, { idPrefix: `${selectedEquipment.id}-quick-main` })}
                alt={title}
                className="h-48 w-full rounded-xl border border-slate-200"
                imgClassName="h-full w-full object-cover"
                fallbackClassName="h-48"
              />
            ) : (
              <div className="flex h-48 w-full items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-slate-400">
                <Boxes className="h-7 w-7" />
                <span className="ml-2 text-sm">Нет фото</span>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {overviewFields.map(field => (
                <PreviewField key={field.label} label={field.label} value={field.value} />
              ))}
            </div>
            <Link to={detailPath}>
              <Button className="w-full" variant="outline">Открыть полную карточку</Button>
            </Link>
          </div>
        )}

        {activeTab === 'specs' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    <div key={slot.label} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span className="font-medium text-slate-900">{slot.label}</span>
                      <span className={slot.count > 0 ? 'text-emerald-600' : 'text-slate-500'}>
                        {slot.count > 0 ? `${slot.count} шт.` : 'Не найдено'}
                      </span>
                    </div>
                  ))}
                </div>
                {documents.length > 0 ? (
                  <div className="space-y-2">
                    {documents.slice(0, 8).map(document => (
                      <div key={document.id} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-900">{document.typeLabel}</div>
                            <div className="mt-1 truncate font-mono text-xs text-slate-500">{document.number}</div>
                          </div>
                          <span className="shrink-0 text-xs text-slate-500">{document.dateLabel}</span>
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

        {activeTab === 'photos' && (
          <div className="space-y-4">
            {!canViewPhotos ? <PreviewEmpty>{EQUIPMENT_QUICK_VIEW_EMPTY_COPY.noPhotosAccess}</PreviewEmpty> : null}
            {photos.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {photos.map(photo => (
                  <figure key={photo.id} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    <AuthenticatedImage
                      photo={normalizePhotoReference(photo.src, { idPrefix: photo.id })}
                      alt={photo.label}
                      className="h-32 w-full rounded-none border-0"
                      imgClassName="h-full w-full object-cover"
                      fallbackClassName="h-32 rounded-none border-0"
                    />
                    <figcaption className="space-y-1 p-2 text-xs">
                      <div className="font-semibold text-slate-900">{photo.label}</div>
                      <div className="line-clamp-2 text-slate-500">{photo.metaLabel}</div>
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <PreviewEmpty>{EQUIPMENT_QUICK_VIEW_EMPTY_COPY.noPhotos}</PreviewEmpty>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-3">
            {timeline.length > 0 ? timeline.map(item => (
              <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{item.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-slate-500">{item.description}</div>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">{item.dateLabel}</span>
                </div>
              </div>
            )) : (
              <PreviewEmpty>{EQUIPMENT_QUICK_VIEW_EMPTY_COPY.noHistory}</PreviewEmpty>
            )}
          </div>
        )}
      </div>
    </aside>
  );

  if (mode === 'inline') return panel;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/25 lg:bg-transparent"
        aria-label="Закрыть быстрый просмотр"
        onClick={onClose}
      />
      {panel}
    </>
  );
}
