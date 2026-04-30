import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dashboardSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/pages/Dashboard.tsx'),
  'utf-8',
);

function openRentalStatusBody() {
  const match = dashboardSource.match(/function isOpenRentalStatus[\s\S]*?\{\n([\s\S]*?)\n\}/);
  assert.ok(match, 'isOpenRentalStatus helper should exist');
  return match[1];
}

test('Dashboard overdue helper counts active rentals as open', () => {
  assert.match(openRentalStatusBody(), /status === 'active'/);
});

test('Dashboard overdue helper does not count returned closed or cancelled rentals as open', () => {
  const body = openRentalStatusBody();
  assert.doesNotMatch(body, /status === 'returned'/);
  assert.doesNotMatch(body, /status === 'closed'/);
  assert.doesNotMatch(body, /status === 'cancelled'/);
});
