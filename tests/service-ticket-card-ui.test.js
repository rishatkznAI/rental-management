import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const servicePageSource = readFileSync(new URL('../src/app/pages/Service.tsx', import.meta.url), 'utf8');
const serviceDetailSource = readFileSync(new URL('../src/app/pages/ServiceDetail.tsx', import.meta.url), 'utf8');
const fieldTripsServiceSource = readFileSync(new URL('../src/app/services/service-field-trips.service.ts', import.meta.url), 'utf8');

test('service ticket card opens from tickets archive planner and warranty claims', () => {
  assert.match(servicePageSource, /function ServiceTicketCardModal/);
  assert.match(servicePageSource, /<ServiceDetail ticketId=\{ticketId\} embedded onClose=\{onClose\}/);

  const activeTabSource = servicePageSource.slice(
    servicePageSource.indexOf('<TabsContent value="tickets"'),
    servicePageSource.indexOf('<TabsContent value="archive"'),
  );
  const archiveTabSource = servicePageSource.slice(
    servicePageSource.indexOf('<TabsContent value="archive"'),
    servicePageSource.indexOf('<TabsContent value="queue"'),
  );
  const plannerTabSource = servicePageSource.slice(
    servicePageSource.indexOf('<TabsContent value="day-plan"'),
    servicePageSource.indexOf('<TabsContent value="warranty"'),
  );
  const warrantyTabSource = servicePageSource.slice(servicePageSource.indexOf('<TabsContent value="warranty"'));

  assert.match(activeTabSource, /openTicketCard\(ticket\.id\)/);
  assert.match(archiveTabSource, /openTicketCard\(ticket\.id\)/);
  assert.match(plannerTabSource, /onOpenTicket=\{openTicketCard\}/);
  assert.match(warrantyTabSource, /onOpenTicket=\{openTicketCard\}/);
});

test('service ticket detail exposes management tabs and full overview sections', () => {
  for (const tab of ['Обзор', 'Работы', 'Запчасти', 'Фото', 'История']) {
    assert.match(serviceDetailSource, new RegExp(`>${tab}<`));
  }
  for (const label of [
    'Паспорт заявки',
    'Клиент и аренда',
    'Проблема и связанные сущности',
    'Модель',
    'Инвентарный номер',
    'Серийный номер',
    'Статус техники',
    'Причина обращения',
    'Кто создал',
    'Итог ремонта',
    'Выезды',
  ]) {
    assert.match(serviceDetailSource, new RegExp(label));
  }
});

test('service ticket card keeps existing editable actions and RBAC gates', () => {
  for (const action of [
    'saveAssignee',
    'changeStatus',
    'addWorkPerformed',
    'addPartUsage',
    'savePhotos',
    'returnForRevision',
    'resolveRevision',
    'handleGenerateWorkOrder',
  ]) {
    assert.match(serviceDetailSource, new RegExp(action));
  }
  assert.match(serviceDetailSource, /const canEditTicketFields = canEdit && \(ticket\.status !== 'closed' \|\| isAdmin\)/);
  assert.match(serviceDetailSource, /const canAddRepairItems = \(isAdmin \|\| \(ticket\.status === 'needs_revision' && isAssignedMechanic\)\) && canEditTicketFields/);
  assert.match(serviceDetailSource, /const canDeleteRepairItems = isAdmin && canEditTicketFields/);
});

test('service ticket card reads related entities without changing service ticket data model', () => {
  assert.match(serviceDetailSource, /clientsService\.getAll/);
  assert.match(serviceDetailSource, /rentalsService\.getAll/);
  assert.match(serviceDetailSource, /rentalsService\.getGanttData/);
  assert.match(serviceDetailSource, /deliveriesService\.getAll/);
  assert.match(serviceDetailSource, /warrantyClaimsService\.getAll/);
  assert.match(serviceDetailSource, /serviceFieldTripsService\.getAll/);
  assert.match(fieldTripsServiceSource, /\/api\/service_field_trips/);
  assert.doesNotMatch(serviceDetailSource, /api\.post<.*service_field_trips/);
  assert.doesNotMatch(serviceDetailSource, /api\.put<.*service_field_trips/);
});

test('service photo surfaces use authenticated media loader for protected uploads', () => {
  assert.match(servicePageSource, /import \{ AuthenticatedImage \} from '\.\.\/components\/ui\/AuthenticatedImage'/);
  assert.match(servicePageSource, /function TicketThumbnail[\s\S]*<AuthenticatedImage[\s\S]*photo=\{photo\}/);

  assert.match(serviceDetailSource, /import \{ AuthenticatedImage \} from '\.\.\/components\/ui\/AuthenticatedImage'/);
  assert.match(serviceDetailSource, /function RepairPhotoGroup[\s\S]*<AuthenticatedImage[\s\S]*photo=\{normalizedPhoto\}/);
  assert.match(serviceDetailSource, /currentEquipment\?\.photo[\s\S]*<AuthenticatedImage[\s\S]*normalizePhotoReference\(currentEquipment\.photo/);
  assert.match(serviceDetailSource, /idPrefix: `\$\{ticket\.id\}-photo-\$\{i\}`[\s\S]*<AuthenticatedImage[\s\S]*photo=\{normalizedPhoto\}/);
  assert.match(serviceDetailSource, /idPrefix: `\$\{ticket\.id\}-photos-tab-\$\{index\}`[\s\S]*<AuthenticatedImage[\s\S]*photo=\{normalizedPhoto\}/);

  assert.doesNotMatch(servicePageSource, /<img\s+src=\{src\}/);
  assert.doesNotMatch(serviceDetailSource, /absoluteMediaUrl\(photoSource\(/);
});
