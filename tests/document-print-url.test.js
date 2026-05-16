import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serviceSource = readFileSync('src/app/services/documents.service.ts', 'utf8');
const drawerSource = readFileSync('src/app/components/gantt/RentalDrawer.tsx', 'utf8');

test('document print service builds URLs from the shared API base', () => {
  assert.match(serviceSource, /import \{ api, API_BASE_URL, ApiError, getToken \} from '\.\.\/lib\/api'/);
  assert.match(serviceSource, /export function getDocumentPrintPath\(id: string\)/);
  assert.match(serviceSource, /return `\/api\/documents\/\$\{encodeURIComponent\(id\)\}\/print`/);
  assert.match(serviceSource, /export function getDocumentPrintUrl\(id: string\)/);
  assert.match(serviceSource, /return `\$\{API_BASE_URL\}\$\{getDocumentPrintPath\(id\)\}`/);
});

test('document print fetch preserves auth without exposing tokens in URLs', () => {
  assert.match(serviceSource, /const token = getToken\(\)/);
  assert.match(serviceSource, /headers\.Authorization = `Bearer \$\{token\}`/);
  assert.match(serviceSource, /credentials: 'include'/);
  assert.doesNotMatch(serviceSource, /token=/i);
});

test('rental drawer uses authenticated print helper instead of frontend-origin links', () => {
  assert.match(drawerSource, /import \{ documentsService \} from '\.\.\/\.\.\/services\/documents\.service'/);
  assert.match(drawerSource, /const html = doc\.printHtml \|\| doc\.generatedContent \|\| doc\.contentHtml \|\| await documentsService\.getPrintHtml\(doc\.id\)/);
  assert.doesNotMatch(drawerSource, /href=\{`\/api\/documents\//);
  assert.doesNotMatch(drawerSource, /href=\{`\/rental-management\/api\/documents\//);
});
