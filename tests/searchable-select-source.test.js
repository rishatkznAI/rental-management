import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/components/ui/SearchableSelect.tsx', import.meta.url), 'utf8');
const serviceDetailSource = readFileSync(new URL('../src/app/pages/ServiceDetail.tsx', import.meta.url), 'utf8');

test('SearchableSelect renders dropdown through a portal above service card layout', () => {
  assert.match(source, /import \{ createPortal \} from 'react-dom'/);
  assert.match(source, /createPortal\(/);
  assert.match(source, /position:\s*'fixed'/);
  assert.match(source, /zIndex:\s*1000/);
  assert.match(source, /typeof window !== 'undefined' && typeof document !== 'undefined'/);
  assert.doesNotMatch(source, /absolute left-0 right-0 top-full z-50/);
});

test('SearchableSelect keeps portal option clicks inside the component and selects reliably', () => {
  assert.match(source, /dropdownRef\.current\?\.contains\(target\)/);
  assert.match(source, /mouseSelectedValueRef\.current = option\.value/);
  assert.match(source, /if \(mouseSelectedValueRef\.current === option\.value\)/);
  assert.match(source, /onMouseDown=\{event => \{[\s\S]*selectValue\(option\.value\);[\s\S]*\}\}/);
  assert.match(source, /onClick=\{event => \{[\s\S]*selectValue\(option\.value\);[\s\S]*\}\}/);
});

test('Service detail keeps part picker controlled by selectedPartId and admin-only', () => {
  assert.match(serviceDetailSource, /value=\{selectedPartId\}/);
  assert.match(serviceDetailSource, /setSelectedPartId\(nextId\)/);
  assert.match(serviceDetailSource, /disabled=\{!selectedPartId\}/);
  assert.match(serviceDetailSource, /canManageRepairItems && scenarioIsRepair/);
});
