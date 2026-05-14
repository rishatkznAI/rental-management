import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const drawerSource = fs.readFileSync(new URL('../src/app/components/gantt/RentalDrawer.tsx', import.meta.url), 'utf8');
const rentalsSource = fs.readFileSync(new URL('../src/app/pages/Rentals.tsx', import.meta.url), 'utf8');
const documentsSource = fs.readFileSync(new URL('../src/app/pages/Documents.tsx', import.meta.url), 'utf8');

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('rental drawer opens and acts through the canonical rental while retaining gantt id', () => {
  const buildBlock = extract(
    rentalsSource,
    'const buildRentalDrawerRental = useCallback',
    'const handleRepairGanttLink = useCallback',
  );

  assert.match(buildBlock, /id: resolvedClassicRental\.id/);
  assert.match(buildBlock, /rentalId: resolvedClassicRental\.id/);
  assert.match(buildBlock, /sourceRentalId: resolvedClassicRental\.id/);
  assert.match(buildBlock, /__ganttRentalId: ganttRental\.id/);
});

test('drawer actions resolve canonical rental back to the working gantt row', () => {
  assert.match(rentalsSource, /function findGanttRentalForDrawer\(rental: GanttRentalData, ganttRentals: GanttRentalData\[\]\)/);
  assert.match(rentalsSource, /function matchesDrawerGanttRental\(item: GanttRentalData, rental: GanttRentalData\)/);
  assert.match(rentalsSource, /getDrawerGanttRentalId\(rental\)/);
  assert.match(rentalsSource, /if \(ganttId\) return item\.id === ganttId/);
  assert.match(rentalsSource, /if \(String\(rental\.id \|\| ''\)\.startsWith\('GR-'\)\) return false/);
  assert.match(rentalsSource, /getGanttRentalSourceId\(item\) === canonicalRentalId/);
});

test('adding a payment from drawer stores stable rental id and updates matching gantt row', () => {
  const paymentBlock = extract(
    rentalsSource,
    'const handleAddPayment = useCallback',
    '// Update UPD signed status',
  );

  assert.match(paymentBlock, /ganttRentals\.find\(r => getGanttRentalSourceId\(r\) === rentalId\)/);
  assert.match(paymentBlock, /findGanttRentalForDrawer\(selectedRental, ganttRentals\)/);
  assert.match(paymentBlock, /const canonicalRentalId = getGanttRentalSourceId\(rental\) \|\| rentalId/);
  assert.match(paymentBlock, /rentalId: canonicalRentalId/);
  assert.match(paymentBlock, /matchesDrawerGanttRental\(r, drawerMatchRental\)/);
  assert.match(paymentBlock, /setGanttRentals\(updatedRentals\)/);
  assert.doesNotMatch(paymentBlock, /persistGanttRentals\(updatedRentals\)/);
});

test('payment tab has no stale undefined handler and includes legacy gantt-linked payments', () => {
  assert.match(drawerSource, /const rentalPaymentIds = new Set/);
  assert.match(drawerSource, /__ganttRentalId/);
  assert.match(drawerSource, /const rentalPayments = payments\.filter\(p => rentalPaymentIds\.has/);
  assert.match(drawerSource, /onAddPayment\(canonicalRentalId \|\| rental\.id/);
  assert.match(drawerSource, /const handlePaymentStatusChange = \(status: GanttRentalData\['paymentStatus'\]\)/);
  assert.doesNotMatch(drawerSource, /onPaymentStatusChange/);
});

test('document tab lists linked rental documents and opens create with canonical context', () => {
  const documentsBlock = extract(drawerSource, "{activeTab === 'documents' && (", "{/* Manager */}");
  const quickActionBlock = extract(
    documentsSource,
    "React.useEffect(() => {\n    const hasContext = hasClientContext(quickActionContext)",
    "const filteredDocuments = documents.filter",
  );

  assert.match(drawerSource, /documents\?: Document\[\]/);
  assert.match(drawerSource, /const relatedDocuments = documents\.filter/);
  assert.match(drawerSource, /doc\.rentalId/);
  assert.match(drawerSource, /doc\.rental/);
  assert.match(drawerSource, /const createDocumentUrl = \(\(\) =>/);
  assert.match(drawerSource, /params\.set\('rentalId', canonicalRentalId\)/);
  assert.match(documentsBlock, /Документы по аренде:/);
  assert.match(documentsBlock, /По этой аренде документы ещё не созданы/);
  assert.match(documentsBlock, /to=\{createDocumentUrl\}/);
  assert.doesNotMatch(documentsBlock, /\/documents\/undefined/);
  assert.match(quickActionBlock, /if \(quickActionContext\.rentalId && !quickActionRental\) return/);
  assert.match(quickActionBlock, /rentalId: quickActionRental\?\.id \|\| ''/);
});

test('history tab tolerates legacy rentals without comments and uses stable keys', () => {
  assert.match(drawerSource, /const rentalComments = Array\.isArray\(rental\.comments\) \? rental\.comments : \[\]/);
  assert.match(drawerSource, /rentalComments\.length === 0/);
  assert.match(drawerSource, /rentalComments\.map/);
  assert.match(drawerSource, /key=\{`\$\{comment\.date \|\| 'date'\}-\$\{comment\.author \|\| 'author'\}-\$\{idx\}`\}/);
});

test('delivery tab keeps an honest empty-state when no delivery is linked', () => {
  const deliveryBlock = extract(drawerSource, "{activeTab === 'delivery' && (", '{/* Documents / UPD */}');

  assert.match(drawerSource, /deliveries\?: Delivery\[\]/);
  assert.match(drawerSource, /const relatedDeliveries = deliveries\.filter/);
  assert.match(drawerSource, /delivery\.rentalId/);
  assert.match(drawerSource, /delivery\.classicRentalId/);
  assert.match(drawerSource, /delivery\.ganttRentalId/);
  assert.match(deliveryBlock, /relatedDeliveries\.length > 0/);
  assert.match(deliveryBlock, /relatedDeliveries\.map/);
  assert.match(deliveryBlock, /По этой аренде доставка ещё не создана/);
  assert.match(deliveryBlock, /Создайте доставку или возвратную доставку/);
  assert.match(deliveryBlock, /createDeliveryUrl\('shipping'\)/);
  assert.match(deliveryBlock, /createDeliveryUrl\('receiving'\)/);
  assert.doesNotMatch(deliveryBlock, /\/deliveries\/undefined/);
});

test('rentals page passes delivery records into rental drawer', () => {
  assert.match(rentalsSource, /import \{ deliveriesService \} from '\.\.\/services\/deliveries\.service'/);
  assert.match(rentalsSource, /const \{ data: deliveriesData = EMPTY_DELIVERIES \} = useQuery<Delivery\[\]>/);
  assert.match(rentalsSource, /queryFn: deliveriesService\.getAll/);
  assert.match(rentalsSource, /deliveries=\{deliveriesData\}/);
  assert.match(rentalsSource, /documents=\{documentsData\}/);
});
