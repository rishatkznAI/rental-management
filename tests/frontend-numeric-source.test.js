import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Payments modal preserves explicit zero paidAmount instead of falling back to amount', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/Payments.tsx'), 'utf-8');

  assert.match(source, /form\.paidAmount === '' \? amt : Number\(form\.paidAmount\)/);
  assert.doesNotMatch(source, /Number\(form\.paidAmount\) \|\| amt/);
});

test('CRM form validates budget and probability instead of silently clamping', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/pages/CRM.tsx'), 'utf-8');

  assert.match(source, /parseBudgetInput\(form\.budget\)/);
  assert.match(source, /parseProbabilityInput\(form\.probability\)/);
  assert.match(source, /Number\.isFinite\(numeric\) && numeric >= 0/);
  assert.match(source, /Number\.isFinite\(numeric\) && numeric >= 0 && numeric <= 100/);
  assert.doesNotMatch(source, /Math\.max\(0, Number\(form\.budget\) \|\| 0\)/);
  assert.doesNotMatch(source, /Math\.min\(100, Math\.max\(0, Number\(form\.probability\) \|\| 0\)\)/);
});
