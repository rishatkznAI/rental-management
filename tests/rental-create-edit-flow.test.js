import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rentalNewSource = fs.readFileSync(new URL('../src/app/pages/RentalNew.tsx', import.meta.url), 'utf8');
const rentalDetailSource = fs.readFileSync(new URL('../src/app/pages/RentalDetail.tsx', import.meta.url), 'utf8');
const rentalsPageSource = fs.readFileSync(new URL('../src/app/pages/Rentals.tsx', import.meta.url), 'utf8');
const dashboardSource = fs.readFileSync(new URL('../src/app/pages/Dashboard.tsx', import.meta.url), 'utf8');
const ganttModalsSource = fs.readFileSync(new URL('../src/app/components/gantt/GanttModals.tsx', import.meta.url), 'utf8');
const equipmentComboboxSource = fs.readFileSync(new URL('../src/app/components/ui/EquipmentCombobox.tsx', import.meta.url), 'utf8');

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('rental creation pages rely on backend linked planner row instead of creating a duplicate gantt row', () => {
  const rentalNewSubmit = extract(rentalNewSource, 'const handleSubmit = async', 'return (');
  const rentalsModalConfirm = extract(rentalsPageSource, 'onConfirm={async (data) => {', '<RentalApprovalHistorySheet');
  const dashboardQuickCreate = extract(dashboardSource, 'onConfirm={(formData) => {', 'setShowRentalModal(false);');

  assert.match(rentalNewSubmit, /rentalsService\.create\(/);
  assert.doesNotMatch(rentalNewSubmit, /createGanttEntry/);
  assert.match(rentalsModalConfirm, /rentalsService\.create\(/);
  assert.match(rentalsModalConfirm, /rentalsService\.getGanttData\(\)/);
  assert.doesNotMatch(rentalsModalConfirm, /createGanttEntry/);
  assert.match(dashboardQuickCreate, /rentalsService\.create\(/);
  assert.doesNotMatch(dashboardQuickCreate, /createGanttEntry/);
});

test('rental detail does not directly update linked planner rows', () => {
  assert.doesNotMatch(rentalDetailSource, /updateGanttEntry/);
  const restoreBlock = extract(rentalDetailSource, 'const handleRestoreRental = async () => {', 'const displayPlannedReturn');
  assert.match(restoreBlock, /rentalsService\.update\(rental\.id/);
  assert.doesNotMatch(restoreBlock, /equipmentService\.update/);
  assert.match(restoreBlock, /setSaveError\(error instanceof Error \? error\.message : 'Не удалось восстановить аренду\.'\)/);
});

test('rental creation keeps stable equipment and manager links in the classic rental payload', () => {
  const rentalNewSubmit = extract(rentalNewSource, 'await rentalsService.create({', '});');

  assert.match(rentalNewSubmit, /equipmentId: selectedEquipment\.id/);
  assert.match(rentalNewSubmit, /equipmentInv: selectedEquipment\.inventoryNumber/);
  assert.match(rentalNewSubmit, /objectId: objectId \|\| undefined/);
  assert.match(rentalNewSubmit, /contractId: contractId \|\| undefined/);
  assert.match(rentalNewSubmit, /manager,/);
  assert.match(rentalNewSubmit, /managerId: managerId \|\| undefined/);
  assert.match(rentalNewSubmit, /status: initialStatus/);
  assert.match(rentalNewSubmit, /paymentStatus: 'unpaid'/);
});

test('standalone rental creation does not patch equipment status through the generic equipment API', () => {
  const rentalNewSubmit = extract(rentalNewSource, 'const handleSubmit = async', 'return (');

  assert.match(rentalNewSubmit, /rentalsService\.create\(/);
  assert.doesNotMatch(rentalNewSource, /useUpdateEquipment/);
  assert.doesNotMatch(rentalNewSubmit, /updateEquipment\.mutateAsync/);
  assert.doesNotMatch(rentalNewSubmit, /equipmentService\.update/);
});

test('rental creation surfaces validation and API errors instead of only logging them', () => {
  assert.match(rentalNewSource, /const \[formError, setFormError\] = useState\(''\)/);
  assert.match(rentalNewSource, /setFormError\('Дата окончания аренды не может быть раньше даты начала\.'\)/);
  assert.match(rentalNewSource, /setFormError\('Для аренды укажите объект клиента и договор\.'\)/);
  assert.match(rentalNewSource, /setFormError\('Техника занята на выбранный период\. Выберите другие даты или другую технику\.'\)/);
  assert.match(rentalNewSource, /setFormError\(error instanceof Error \? error\.message : 'Не удалось создать аренду\.'\)/);
  assert.match(rentalNewSource, /\{formError && \(/);
  assert.match(ganttModalsSource, /const \[submitError,\s+setSubmitError\]\s+= useState\(''\)/);
  assert.match(ganttModalsSource, /setSubmitError\('Для аренды укажите объект клиента и договор\.'\)/);
  assert.match(ganttModalsSource, /setSubmitError\(error instanceof Error \? error\.message : 'Не удалось создать аренду\.'\)/);
});

test('rental creation modal does not close itself before async save succeeds', () => {
  const submitBlock = extract(ganttModalsSource, 'const submit = async () => {', '};\n\n  return (');
  const buttonBlock = extract(ganttModalsSource, '<Button\n            onClick={() => { void submit(); }}', '</Button>');

  assert.match(submitBlock, /await onConfirm\(/);
  assert.doesNotMatch(submitBlock, /onClose\(\)/);
  assert.match(buttonBlock, /disabled=\{isSubmitting \|\| !selectedClient \|\| !objectId \|\| !contractId \|\| !selectedEquipment \|\| !startDate \|\| !endDate \|\| conflictWarn\}/);
});

test('standalone rental creation form loads manager options', () => {
  assert.match(rentalNewSource, /staffService\.getManagerOptions\(\)/);
  assert.match(rentalNewSource, /filterRentalManagerUsers\(users\)/);
  assert.match(rentalNewSource, /Выберите менеджера/);
});

test('standalone rental creation keeps selected manager label visible from stable string id', () => {
  assert.match(rentalNewSource, /const managerOptionLabel = \(manager: StaffOption\) => \{/);
  assert.match(rentalNewSource, /return name \|\| email \|\| 'Менеджер без имени'/);
  assert.match(rentalNewSource, /id: selectId\(item\.id\),\s*label: managerOptionLabel\(item\)/);
  assert.match(rentalNewSource, /const selectedManagerOption = managerOptions\.find\(option => option\.id === managerId\)/);
  assert.match(rentalNewSource, /const selected = managers\.find\(item => selectId\(item\.id\) === value\)/);
  assert.match(rentalNewSource, /setManager\(selectedLabel\)/);
  assert.match(rentalNewSource, /<span data-slot="select-value" className="truncate">\{selectedManagerOption\.label\}<\/span>/);
  assert.match(rentalNewSource, /<SelectItem key=\{option\.id\} value=\{option\.id\}>\{option\.label\}<\/SelectItem>/);
  assert.match(rentalNewSource, /Нет доступных менеджеров для назначения\./);
});

test('standalone rental creation submit button creates a rental, not a contract', () => {
  const submitActions = extract(rentalNewSource, '<div className="flex gap-3 pt-4">', '</div>');

  assert.match(submitActions, /<Button type="submit"/);
  assert.match(submitActions, /'Создать аренду'/);
  assert.doesNotMatch(submitActions, /Создать договор/);
});

test('rental creation UI makes client object and contract requirements explicit', () => {
  assert.match(rentalNewSource, /Объект клиента <span className="text-red-500">\*<\/span>/);
  assert.match(rentalNewSource, /Договор <span className="text-red-500">\*<\/span>/);
  assert.match(rentalNewSource, /Для создания аренды сначала добавьте объект/);
  assert.match(rentalNewSource, /disabled=\{isSubmitting \|\| !client \|\| !objectId \|\| !contractId/);
  assert.match(ganttModalsSource, /clientObjectsService\.getAll/);
  assert.match(ganttModalsSource, /clientContractsService\.getAll/);
  assert.match(ganttModalsSource, /objectId,/);
  assert.match(ganttModalsSource, /contractId,/);
  assert.match(rentalsPageSource, /objectId: data\.objectId \|\| undefined/);
  assert.match(rentalsPageSource, /contractId: data\.contractId \|\| undefined/);
});

test('standalone rental creation keeps object and contract selects controlled by stable string ids', () => {
  assert.match(rentalNewSource, /const selectId = \(value: unknown\) => \(value === undefined \|\| value === null \? '' : String\(value\)\)/);
  assert.match(rentalNewSource, /id: selectId\(object\.id\),\s*label: clientObjectLabel\(object\)/);
  assert.match(rentalNewSource, /id: selectId\(contract\.id\),\s*label: clientContractLabel\(contract\)/);
  assert.match(rentalNewSource, /setObjectId\(value === 'none' \? '' : value\);\s*setContractId\(''\);/);
  assert.match(rentalNewSource, /setClient\(selected \? clientLabel\(selected\) : ''\);\s*setObjectId\(''\);\s*setContractId\(''\);/);
  assert.doesNotMatch(rentalNewSource, /useEffect\(\(\) => \{\s*setObjectId\(''\);\s*setContractId\(''\);\s*\}, \[clientId\]\)/);
  assert.match(rentalNewSource, /<span data-slot="select-value" className="truncate">\{selectedObjectOption\.label\}<\/span>/);
  assert.match(rentalNewSource, /<SelectValue placeholder="Выберите объект" \/>/);
  assert.match(rentalNewSource, /<span data-slot="select-value" className="truncate">\{selectedContractOption\.label\}<\/span>/);
  assert.match(rentalNewSource, /<SelectValue placeholder="Выберите договор" \/>/);
  assert.match(rentalNewSource, /return name \|\| address \|\| 'Объект без названия'/);
  assert.match(rentalNewSource, /return number \|\| title \|\| date \|\| 'Договор без номера'/);
  assert.match(rentalNewSource, /Для выбранного клиента и объекта нет активных договоров/);
});

test('standalone rental creation keeps selected client label visible from stable client id', () => {
  assert.match(rentalNewSource, /import \{ clientLabel \} from '\.\.\/components\/ui\/ClientCombobox'/);
  assert.match(rentalNewSource, /const selectedClient = clients\.find\(item => selectId\(item\.id\) === clientId\) \?\? clients\.find\(item => clientLabel\(item\) === client\)/);
  assert.match(rentalNewSource, /const selectedClientName = selectedClient \? clientLabel\(selectedClient\) : client/);
  assert.match(rentalNewSource, /setClient\(selected \? clientLabel\(selected\) : ''\)/);
  assert.match(rentalNewSource, /<SelectItem key=\{c\.id\} value=\{selectId\(c\.id\)\}>\{c\.company\}<\/SelectItem>/);
  assert.match(rentalNewSource, /<SelectValue placeholder="Выберите клиента">\s*\{selectedClient \? selectedClientName : undefined\}\s*<\/SelectValue>/);
  assert.match(rentalNewSource, /\{selectedClient && \(/);
  assert.match(rentalNewSource, /Внимание: у клиента есть просроченная задолженность/);
  assert.match(rentalNewSource, /selectedClientReceivable\?\.currentDebt \?\? selectedClient\.debt \?\? 0/);
});

test('equipment combobox search tolerates legacy equipment with missing labels', () => {
  assert.match(equipmentComboboxSource, /String\(eq\.manufacturer \|\| ''\)\.toLowerCase\(\)\.includes\(lower\)/);
  assert.match(equipmentComboboxSource, /String\(eq\.model \|\| ''\)\.toLowerCase\(\)\.includes\(lower\)/);
  assert.match(equipmentComboboxSource, /String\(eq\.inventoryNumber \|\| ''\)\.toLowerCase\(\)\.includes\(lower\)/);
  assert.match(equipmentComboboxSource, /INV \$\{eq\.inventoryNumber \|\| 'не указан'\}/);
});
