import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const servicePageSource = readFileSync(new URL('../src/app/pages/Service.tsx', import.meta.url), 'utf8');

test('service page routes active and archived tickets into request-level tabs', () => {
  assert.match(servicePageSource, /import \{ isActiveServiceTicket, isArchivedServiceTicket, isRegularServiceTicket \}/);
  assert.match(servicePageSource, /const activeTickets = React\.useMemo\(\s*\(\) => ticketList\.filter\(isActiveServiceTicket\)/);
  assert.match(servicePageSource, /const archivedTickets = React\.useMemo\(\s*\(\) => ticketList\.filter\(isArchivedServiceTicket\)/);
  assert.match(servicePageSource, /return activeTickets\s*\.filter\(ticket => \{/);
  assert.match(servicePageSource, /label: 'Архив'/);
  assert.match(servicePageSource, /requestTab !== 'archive'/);
  assert.doesNotMatch(servicePageSource, /<TabsTrigger\s+value="archive"/);
});

test('service active requests no longer offer closed status and archive opens ticket cards', () => {
  const activeTabStart = servicePageSource.indexOf('<TabsContent value="tickets"');
  const queueTabStart = servicePageSource.indexOf('<TabsContent value="queue"');
  assert.ok(activeTabStart > 0, 'active tickets tab exists');
  assert.ok(queueTabStart > activeTabStart, 'legacy queue content follows tickets tab');

  const activeTabSource = servicePageSource.slice(activeTabStart, queueTabStart);
  const activeRequestsSource = activeTabSource.slice(
    activeTabSource.indexOf("{requestTab !== 'archive'"),
    activeTabSource.indexOf(") : ("),
  );
  const archiveTabSource = activeTabSource.slice(activeTabSource.indexOf(") : ("));

  assert.doesNotMatch(activeRequestsSource, /<SelectItem value="closed">/);
  assert.match(activeTabSource, /ServiceMetricCard title="Актуальные" value=\{metrics\.total\}/);
  assert.match(activeTabSource, /ServiceMetricCard title="Без механика" value=\{metrics\.unassigned\}/);
  assert.match(archiveTabSource, /ServiceMetricCard title="Всего в архиве" value=\{archiveMetrics\.total\}/);
  assert.match(archiveTabSource, /ServiceMetricCard title="Закрыто за месяц" value=\{archiveMetrics\.closedThisMonth\}/);
  assert.match(archiveTabSource, /ServiceMetricCard title="Среднее закрытие" value=\{archiveMetrics\.averageClosureDays\}/);
  assert.match(archiveTabSource, /<SelectItem value="closed">Закрыта<\/SelectItem>/);
  assert.match(archiveTabSource, /aria-label=\{`Открыть архивную заявку \$\{ticket\.id\}`\}/);
  assert.match(archiveTabSource, /openTicketCard\(ticket\.id\)/);
});
