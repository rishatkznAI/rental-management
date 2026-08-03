import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const zones = [
  ['America/Los_Angeles', '01.08.2026'],
  ['UTC', '02.08.2026'],
  ['Asia/Tokyo', '02.08.2026'],
];

test('date-only formatting preserves 2026-08-02 west of UTC, in UTC, and east of UTC', () => {
  for (const [timezone, expectedTimestampDate] of zones) {
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      [
        "import { formatDateValue } from './src/app/lib/date.js';",
        "console.log(JSON.stringify({ dateOnly: formatDateValue('2026-08-02'), timestamp: formatDateValue('2026-08-02T00:30:00.000Z') }));",
      ].join('\n'),
    ], {
      cwd: process.cwd(),
      env: { ...process.env, TZ: timezone },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.dateOnly, '02.08.2026', timezone);
    assert.equal(output.timestamp, expectedTimestampDate, `${timezone}: timestamp semantics must remain local`);
  }
});

test('date-only parser rejects impossible calendar dates', async () => {
  const { parseDateOnly, formatDateValue } = await import('../src/app/lib/date.js');
  assert.equal(parseDateOnly('2026-02-30'), null);
  assert.equal(formatDateValue('2026-02-30'), '—');
});

test('affected product areas use the shared date-only-aware formatter or parser', () => {
  const sharedFormatterFiles = [
    'src/app/pages/ServiceVehicles.tsx',
    'src/app/pages/ServiceVehicleDetail.tsx',
    'src/app/pages/Finance.tsx',
    'src/app/pages/RentalDetail.tsx',
    'src/app/pages/Deliveries.tsx',
    'src/app/pages/Documents.tsx',
    'src/app/pages/Service.tsx',
    'src/app/pages/ServiceDetail.tsx',
    'src/app/pages/Payroll.tsx',
  ];

  for (const file of sharedFormatterFiles) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /formatDate/, file);
    assert.match(source, /lib\/utils/, file);
  }

  const planner = readFileSync('src/app/pages/Planner.tsx', 'utf8');
  assert.match(planner, /parseDateValue/);
  assert.doesNotMatch(planner, /new Date\(row\.startDate\)/);

  for (const file of [
    'src/app/pages/ServiceVehicles.tsx',
    'src/app/pages/ServiceVehicleDetail.tsx',
    'src/app/pages/RentalDetail.tsx',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /parseDateValue/, file);
  }
});
