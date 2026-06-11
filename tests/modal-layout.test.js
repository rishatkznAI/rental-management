import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dialogSource = fs.readFileSync(path.join(process.cwd(), 'src/app/components/ui/dialog.tsx'), 'utf8');
const sheetSource = fs.readFileSync(path.join(process.cwd(), 'src/app/components/ui/sheet.tsx'), 'utf8');
const equipmentDetailSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/EquipmentDetail.tsx'), 'utf8');
const ganttModalsSource = fs.readFileSync(path.join(process.cwd(), 'src/app/components/gantt/GanttModals.tsx'), 'utf8');
const serviceTicketFormSource = fs.readFileSync(path.join(process.cwd(), 'src/app/components/service/ServiceTicketForm.tsx'), 'utf8');
const pdiFormSource = fs.readFileSync(path.join(process.cwd(), 'src/app/components/sales/PdiForm.tsx'), 'utf8');
const paymentsSource = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Payments.tsx'), 'utf8');

test('shared dialog shell keeps action footer inside the viewport', () => {
  assert.match(dialogSource, /max-h-\[min\(92dvh,calc\(100dvh-2rem\),760px\)\]/);
  assert.match(dialogSource, /overflow-hidden/);
  assert.match(dialogSource, /sticky bottom-0 z-10/);
  assert.match(dialogSource, /flex shrink-0 flex-col-reverse/);
  assert.match(dialogSource, /pb-\[env\(safe-area-inset-bottom\)\]/);
  assert.match(dialogSource, /bg-card text-card-foreground/);
  assert.match(dialogSource, /bg-card\/95/);
  assert.match(dialogSource, /backdrop-blur/);
});

test('shared sheet footer is sticky and safe-area aware', () => {
  assert.match(sheetSource, /sticky bottom-0 z-10/);
  assert.match(sheetSource, /flex shrink-0 flex-col/);
  assert.match(sheetSource, /pb-\[calc\(1rem\+env\(safe-area-inset-bottom\)\)\]/);
});

test('equipment edit modal uses header, scrollable body and fixed action footer', () => {
  const modalStart = equipmentDetailSource.indexOf('function EditEquipmentModal');
  const modalEnd = equipmentDetailSource.indexOf('export {', modalStart);
  const modalSource = equipmentDetailSource.slice(modalStart, modalEnd > modalStart ? modalEnd : undefined);

  assert.match(modalSource, /flex max-h-\[min\(92dvh,calc\(100dvh-2rem\)\)\]/);
  assert.match(modalSource, /shrink-0 border-b/);
  assert.match(modalSource, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(modalSource, /sticky bottom-0 z-10 flex shrink-0/);
  assert.match(modalSource, /pb-\[calc\(1rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.doesNotMatch(modalSource, /maxHeight: 'calc\(92vh - 130px\)'/);
});

test('custom gantt modals share the viewport-safe footer layout', () => {
  assert.match(ganttModalsSource, /modalSurfaceClass = '.*max-h-\[min\(92dvh,calc\(100dvh-2rem\)\)\]/);
  assert.match(ganttModalsSource, /modalFooterClass = '.*sticky bottom-0 z-10/);
  assert.match(ganttModalsSource, /modalFooterClass = '.*shrink-0/);
  assert.match(ganttModalsSource, /modalFooterClass = '.*safe-area-inset-bottom/);
});

test('equipment service and PDI modals opt into sticky form actions', () => {
  assert.match(equipmentDetailSource, /<Dialog\.Content className=\{animatedModalClassName\('flex max-h-\[min\(92dvh,calc\(100dvh-2rem\)\)\]/);
  assert.match(equipmentDetailSource, /<PdiForm[\s\S]*stickyActions/);
  assert.match(equipmentDetailSource, /<ServiceTicketForm[\s\S]*stickyActions/);
  assert.match(serviceTicketFormSource, /stickyActions\?: boolean/);
  assert.match(serviceTicketFormSource, /sticky bottom-0 z-10 flex shrink-0/);
  assert.match(pdiFormSource, /stickyActions\?: boolean/);
  assert.match(pdiFormSource, /sticky bottom-0 z-10 flex shrink-0/);
});

test('payments add modal is portaled and centered by a viewport wrapper', () => {
  const modalStart = paymentsSource.indexOf('function AddPaymentModal');
  const modalEnd = paymentsSource.indexOf('type AllocationDraft', modalStart);
  const modalSource = paymentsSource.slice(modalStart, modalEnd > modalStart ? modalEnd : undefined);

  assert.match(modalSource, /createPortal\(/);
  assert.match(modalSource, /document\.body/);
  assert.match(modalSource, /fixed inset-0 z-50 grid place-items-center overflow-y-auto/);
  assert.match(modalSource, /max-h-\[min\(92dvh,calc\(100dvh-2rem\)\)\]/);
  assert.match(modalSource, /min-h-0 flex-1 space-y-4 overflow-y-auto/);
  assert.match(modalSource, /pb-\[calc\(1rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.doesNotMatch(modalSource, /app-animate-modal fixed left-1\/2 top-1\/2/);
});
