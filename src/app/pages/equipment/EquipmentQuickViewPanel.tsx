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

type EquipmentQuickViewPanelProps = EquipmentQuickViewPanelData & {
  selectedEquipment: EquipmentEntity | null;
  activeTab: EquipmentPreviewTab;
  onTabChange: (tab: EquipmentPreviewTab) => void;
  onClose: () => void;
};

function PreviewField({ label, value }: EquipmentPreviewField) {
  return (
    <div className="min-w-0 rounded-lg bg-secondary/60 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-foreground">{value || '—'}</div>
    </div>
  );
}

function PreviewEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
      {children}
    </div>
  );
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
  inventoryNumber,
  serialNumber,
  quickActions,
  overviewFields,
  specFields,
  canViewDocuments,
  documentSlots,
  documents,
  docsPath,
  canViewPhotos,
  photos,
  timeline,
}: EquipmentQuickViewPanelProps) {
  if (!selectedEquipment) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/25 lg:bg-transparent"
        aria-label="Закрыть быстрый просмотр"
        onClick={onClose}
      />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col border-l border-border bg-background shadow-2xl">
        <div className="border-b border-border p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="app-shell-title truncate text-xl font-extrabold text-foreground">{title}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusClassName}`}>
                  {statusLabel}
                </span>
                <span className="inline-flex max-w-full rounded-full bg-secondary px-2.5 py-1 font-mono text-xs text-muted-foreground">
                  <span className="truncate">INV {inventoryNumber || '—'}</span>
                </span>
                <span className="inline-flex max-w-full rounded-full bg-secondary px-2.5 py-1 font-mono text-xs text-muted-foreground">
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

        <div className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2">
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
                  className="h-56 w-full rounded-xl border border-border"
                  imgClassName="h-full w-full object-cover"
                  fallbackClassName="h-56"
                />
              ) : (
                <div className="flex h-56 w-full items-center justify-center rounded-xl border border-dashed border-border bg-secondary/60 text-muted-foreground">
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
                      <div key={slot.label} className="flex items-center justify-between rounded-lg bg-secondary/60 px-3 py-2 text-sm">
                        <span className="font-medium text-foreground">{slot.label}</span>
                        <span className={slot.count > 0 ? 'text-emerald-300' : 'text-muted-foreground'}>
                          {slot.count > 0 ? `${slot.count} шт.` : 'Не найдено'}
                        </span>
                      </div>
                    ))}
                  </div>
                  {documents.length > 0 ? (
                    <div className="space-y-2">
                      {documents.slice(0, 8).map(document => (
                        <div key={document.id} className="rounded-lg border border-border p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-foreground">{document.typeLabel}</div>
                              <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{document.number}</div>
                            </div>
                            <span className="shrink-0 text-xs text-muted-foreground">{document.dateLabel}</span>
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
              {!canViewPhotos ? (
                <PreviewEmpty>{EQUIPMENT_QUICK_VIEW_EMPTY_COPY.noPhotosAccess}</PreviewEmpty>
              ) : null}
              {photos.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {photos.map(photo => (
                    <figure key={photo.id} className="overflow-hidden rounded-xl border border-border bg-secondary/40">
                      <AuthenticatedImage
                        photo={normalizePhotoReference(photo.src, { idPrefix: photo.id })}
                        alt={photo.label}
                        className="h-32 w-full rounded-none border-0"
                        imgClassName="h-full w-full object-cover"
                        fallbackClassName="h-32 rounded-none border-0"
                      />
                      <figcaption className="space-y-1 p-2 text-xs">
                        <div className="font-semibold text-foreground">{photo.label}</div>
                        <div className="line-clamp-2 text-muted-foreground">{photo.metaLabel}</div>
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
                <div key={item.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">{item.title}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.description}</div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{item.dateLabel}</span>
                  </div>
                </div>
              )) : (
                <PreviewEmpty>{EQUIPMENT_QUICK_VIEW_EMPTY_COPY.noHistory}</PreviewEmpty>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
