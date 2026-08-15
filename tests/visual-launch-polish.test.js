import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layoutSource = readFileSync(new URL('../src/app/components/layout/Layout.tsx', import.meta.url), 'utf8');
const clientDetailSource = readFileSync(new URL('../src/app/pages/ClientDetail.tsx', import.meta.url), 'utf8');
const paymentsSource = readFileSync(new URL('../src/app/pages/Payments.tsx', import.meta.url), 'utf8');
const themeSource = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8');

test('route transitions reset the document scroll position before paint', () => {
  assert.match(layoutSource, /useLayoutEffect\(\(\) => \{\s*window\.scrollTo\(\{ top: 0, left: 0, behavior: 'auto' \}\);\s*\}, \[location\.pathname\]\);/);
});

test('Client 360 grid items can shrink to the mobile viewport', () => {
  assert.match(clientDetailSource, /grid min-w-0 gap-4 xl:grid-cols-\[minmax\(0,1fr\)_320px\]/);
  assert.match(clientDetailSource, /<div className="min-w-0 space-y-4">/);
});

test('payment dialog uses in-flow surface motion inside its viewport centering wrapper', () => {
  const modalStart = paymentsSource.indexOf('function AddPaymentModal');
  const modalEnd = paymentsSource.indexOf('type AllocationDraft', modalStart);
  const modalSource = paymentsSource.slice(modalStart, modalEnd);

  assert.match(modalSource, /fixed inset-0 z-50 grid place-items-center overflow-y-auto/);
  assert.match(modalSource, /app-animate-dialog-surface relative z-10/);
  assert.doesNotMatch(modalSource, /app-animate-modal relative/);
  assert.match(themeSource, /\.app-animate-dialog-surface\[data-state="open"\]/);
  assert.match(themeSource, /@keyframes app-dialog-surface-in/);
  assert.doesNotMatch(themeSource, /@keyframes app-dialog-surface-in \{[\s\S]*translate\(-50%/);
});
