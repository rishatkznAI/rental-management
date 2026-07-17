import {
  openExistingBillingSourceContext,
} from '../billing-source-authority-fixtures.js';

const dbPath = process.argv[2];
const workerId = process.argv[3];

process.on('message', message => {
  if (message?.type !== 'run') return;
  const context = openExistingBillingSourceContext(dbPath, {
    correlationId: `billing-source-concurrency-${workerId}`,
  });
  try {
    const result = context.service[message.method](context.commandContext, message.command);
    process.send?.({ ok: true, result });
  } catch (error) {
    process.send?.({
      ok: false,
      code: error?.code || null,
      message: error?.message || String(error),
    });
  } finally {
    context.close();
    process.disconnect();
  }
});

process.send?.({ type: 'ready' });
