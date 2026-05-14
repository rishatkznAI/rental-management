import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const badgeSource = readFileSync(new URL('../src/app/components/ui/badge.tsx', import.meta.url), 'utf8');
const rentalDetailSource = readFileSync(new URL('../src/app/pages/RentalDetail.tsx', import.meta.url), 'utf8');

test('rental detail status badge has defensive fallback for legacy statuses', () => {
  assert.match(rentalDetailSource, /getRentalStatusBadge\(isEditing \? formState\.status : rental\.status\)/);
  assert.match(badgeSource, /function getBadgeMeta/);
  assert.match(badgeSource, /readableFallback/);
  assert.match(badgeSource, /map\[key\] \|\| \{ label: readableFallback\(value, emptyLabel\), variant: 'default' \}/);
  assert.match(badgeSource, /getRentalStatusBadge\(status: RentalStatus \| string \| null \| undefined\)/);
  assert.doesNotMatch(badgeSource, /const \{ label, variant \} = map\[status\];/);
});

