import { openExistingForecastTestContext } from '../forecast-receivables-planning-fixtures.js';

const [, , dbPath, commandJson] = process.argv;
const context = openExistingForecastTestContext(dbPath);
try {
  const command = JSON.parse(commandJson);
  const result = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    command,
  );
  process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    code: error?.code || 'UNKNOWN',
    message: error?.message || String(error),
  })}\n`);
} finally {
  context.close();
}
