import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const featuresSource = fs.readFileSync(path.join(root, 'src/app/lib/features.ts'), 'utf8');
const permissionsSource = fs.readFileSync(path.join(root, 'src/app/lib/permissions.ts'), 'utf8');
const quickActionsSource = fs.readFileSync(path.join(root, 'src/app/lib/quickActions.js'), 'utf8');
const crmPageSource = fs.readFileSync(path.join(root, 'src/app/pages/CRM.tsx'), 'utf8');
const clientDetailSource = fs.readFileSync(path.join(root, 'src/app/pages/ClientDetail.tsx'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(root, 'src/app/pages/Dashboard.tsx'), 'utf8');
const settingsSource = fs.readFileSync(path.join(root, 'src/app/pages/Settings.tsx'), 'utf8');
const knowledgeBaseSource = fs.readFileSync(path.join(root, 'src/app/pages/KnowledgeBase.tsx'), 'utf8');

test('CRM UI is disabled by default behind the VITE_CRM_ENABLED flag', () => {
  assert.match(featuresSource, /VITE_CRM_ENABLED/);
  assert.match(featuresSource, /envFlagEnabled\(import\.meta\.env\.VITE_CRM_ENABLED\)/);
  assert.doesNotMatch(featuresSource, /export const isCrmEnabled = true/);

  assert.match(permissionsSource, /section === 'crm' && !isCrmEnabled/);
  assert.match(crmPageSource, /<Navigate to="\/sales" replace \/>/);
  assert.match(quickActionsSource, /crmEnabled = false/);
  assert.match(quickActionsSource, /crmEnabled && safeCrmDealsRoute && canDo\(can, 'view', 'crm'\)/);
});

test('CRM calls and visits are not mounted in customer-facing surfaces while disabled', () => {
  assert.match(clientDetailSource, /isCrmEnabled && client && can\('view', 'crm'\)/);
  assert.match(clientDetailSource, /isCrmEnabled && can\('create', 'crm'\)/);
  assert.match(dashboardSource, /const activityUiEnabled = isCrmEnabled/);
  assert.match(dashboardSource, /activityUiEnabled && \(/);
  assert.match(settingsSource, /sidebarOrder\.filter\(section => section !== 'crm'\)/);
});

test('knowledge base copy does not expose CRM as an active training topic', () => {
  assert.doesNotMatch(knowledgeBaseSource, /CRM-дисциплина/);
  assert.doesNotMatch(knowledgeBaseSource, /Аренда, Продажи, CRM, Общее/);
  assert.doesNotMatch(knowledgeBaseSource, /следующий шаг в CRM/);
});

test('knowledge base treats legacy modules without quiz as empty tests', () => {
  assert.match(knowledgeBaseSource, /function getModuleQuiz\(module: KnowledgeBaseModule \| null \| undefined\)/);
  assert.match(knowledgeBaseSource, /Array\.isArray\(module\?\.quiz\) \? module\.quiz : \[\]/);
  assert.doesNotMatch(knowledgeBaseSource, /selectedModule\.quiz/);
  assert.doesNotMatch(knowledgeBaseSource, /module\.quiz\.length/);
});
