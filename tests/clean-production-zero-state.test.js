import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function readSource(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('client registry derives every headline metric from loaded records without demo fallbacks', () => {
  const source = readSource('src/app/pages/Clients.tsx');

  assert.doesNotMatch(source, /DEMO_(?:TOTAL_CLIENTS|RENTAL_CLIENTS|SALE_CLIENTS|TURNOVER|NEW_CLIENTS)/);
  assert.doesNotMatch(source, /MANAGER_FALLBACKS/);
  assert.match(source, /const displayTotal = totalClients;/);
  assert.match(source, /const displayRental = rentalClientCount;/);
  assert.match(source, /const displaySale = saleClientCount;/);
  assert.match(source, /const displayTurnover = turnover;/);
  assert.match(source, /const displayNew = newThisMonth;/);
  assert.match(source, /safeText\(client\.manager, 'Не назначен'\)/);
});

test('admin users and activity timestamps never fall back to invented records', () => {
  const source = readSource('src/app/pages/Settings.tsx');

  assert.doesNotMatch(source, /ADMIN_DEMO_USERS|ADMIN_LAST_LOGIN_FALLBACKS/);
  assert.match(source, /const displayUsers = users;/);
  assert.match(source, /const userCount = users\.length;/);
  assert.match(source, /record\.lastLoginAt[\s\S]*?'—'/);
});

test('production finance smoke accepts a missing fixture only after proving an exact empty fleet', () => {
  const source = readSource('e2e/finance-production-smoke.spec.ts');

  assert.match(source, /cleanEmptyFleet = Number\(discovery\.diagnostics\.fetched\.totalEquipment \|\| 0\) === 0/);
  assert.match(source, /fixtureWarning && !cleanEmptyFleet/);
  assert.match(source, /missing smoke fixture is safe only for an exactly empty fleet/);
  assert.match(source, /Техника ещё не добавлена/);
});
