import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const clientDetail = readFileSync(new URL('src/app/pages/ClientDetail.tsx', root), 'utf8');
const relationHooks = readFileSync(new URL('src/app/hooks/useClientRelations.ts', root), 'utf8');
const contractService = readFileSync(new URL('src/app/services/client-contracts.service.ts', root), 'utf8');

test('Client Detail exposes the required active and archived contract lifecycle actions', () => {
  assert.match(clientDetail, /onClick=\{\(\) => openContract\(contract\)\}[\s\S]*?\u041eткрыть/);
  assert.match(clientDetail, /onClick=\{\(\) => startEditContract\(contract\)\}[\s\S]*?\u0418зменить/);
  assert.match(clientDetail, /contract\.status !== 'archived'[\s\S]*?\u0410рхивировать/);
  assert.match(clientDetail, /contract\.status === 'archived'[\s\S]*?handleDeleteContract\(contract\)[\s\S]*?\u0423далить/);
});

test('contract edit mode reuses the creation fields and prefills every modeled business field', () => {
  assert.match(clientDetail, /function ContractFormFields/);
  assert.equal((clientDetail.match(/<ContractFormFields/g) || []).length, 2);
  assert.match(clientDetail, /function clientContractDraft\(contract: ClientContract\)/);
  assert.match(clientDetail, /date: contract\.date \|\| ''/);
  assert.match(clientDetail, /title: contract\.title \|\| ''/);
  assert.match(clientDetail, /objectId: contract\.objectId \|\| ''/);
  assert.match(clientDetail, /notes: contract\.notes \|\| ''/);
  assert.match(clientDetail, /setEditContractForm\(clientContractDraft\(contract\)\)/);
  assert.match(clientDetail, /status === 'archived' \? 'Архив' : 'Активен'/);
});

test('contract editing uses scoped PATCH and cache invalidation instead of recreate or bulk replace', () => {
  assert.match(contractService, /api\.patch<ClientContract>\(`\/api\/client_contracts\/\$\{id\}`/);
  assert.match(relationHooks, /export function useUpdateClientContract/);
  assert.match(relationHooks, /CLIENT_KEYS\.detail\(updated\.clientId\)/);
  assert.doesNotMatch(clientDetail, /deleteClientContract[\s\S]{0,300}createClientContract/);
  assert.doesNotMatch(contractService, /api\.put/);
});
