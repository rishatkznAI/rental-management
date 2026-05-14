import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const servicePageSource = readFileSync(new URL('../src/app/pages/Service.tsx', import.meta.url), 'utf8');

test('service page routes active and archived tickets into separate top-level tabs', () => {
  assert.match(servicePageSource, /import \{ isActiveServiceTicket, isArchivedServiceTicket, isRegularServiceTicket \}/);
  assert.match(servicePageSource, /const activeTickets = React\.useMemo\(\s*\(\) => ticketList\.filter\(isActiveServiceTicket\)/);
  assert.match(servicePageSource, /const archivedTickets = React\.useMemo\(\s*\(\) => ticketList\.filter\(isArchivedServiceTicket\)/);
  assert.match(servicePageSource, /return activeTickets\s*\.filter\(ticket => \{/);
  assert.match(servicePageSource, /<TabsTrigger\s+value="archive"/);
  assert.match(servicePageSource, /<TabsContent value="archive"/);
});

test('service active tab no longer offers closed status and archive opens ticket cards', () => {
  const activeTabStart = servicePageSource.indexOf('<TabsContent value="tickets"');
  const archiveTabStart = servicePageSource.indexOf('<TabsContent value="archive"');
  const queueTabStart = servicePageSource.indexOf('<TabsContent value="queue"');
  assert.ok(activeTabStart > 0, 'active tickets tab exists');
  assert.ok(archiveTabStart > activeTabStart, 'archive tab follows tickets tab');
  assert.ok(queueTabStart > archiveTabStart, 'queue tab follows archive tab');

  const activeTabSource = servicePageSource.slice(activeTabStart, archiveTabStart);
  const archiveTabSource = servicePageSource.slice(archiveTabStart, queueTabStart);

  assert.doesNotMatch(activeTabSource, /<SelectItem value="closed">/);
  assert.match(activeTabSource, /ServiceMetricCard title="Всего заявок" value=\{metrics\.total\}/);
  assert.match(archiveTabSource, /ServiceMetricCard title="В архиве" value=\{archivedTickets\.length\}/);
  assert.match(archiveTabSource, /<SelectItem value="closed">Закрыта<\/SelectItem>/);
  assert.match(archiveTabSource, /aria-label=\{`Открыть архивную заявку \$\{ticket\.id\}`\}/);
  assert.match(archiveTabSource, /openTicketCard\(ticket\.id\)/);
});
