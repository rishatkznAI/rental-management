import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Payments modal preserves explicit zero paidAmount instead of falling back to amount', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Payments.tsx'), 'utf-8');

  assert.match(source, /form\.paidAmount === '' \? amt : Number\(form\.paidAmount\)/);
  assert.doesNotMatch(source, /Number\(form\.paidAmount\) \|\| amt/);
});
