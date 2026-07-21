import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  createPlatformIdentityRepository,
} = require('../../server/lib/platform-identity-repository.js');
const {
  resolveTrustedScope,
} = require('../../server/lib/platform-authorization.js');
const {
  createActualSourceEligibilityDryRunService,
} = require('../../server/lib/actual-source-eligibility-dry-run-service.js');

const [dbPath, encodedCommand] = process.argv.slice(2);
const command = JSON.parse(Buffer.from(encodedCommand, 'base64url').toString('utf8'));
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

try {
  const readUsers = () => {
    const row = db.prepare("SELECT json FROM app_data WHERE name = 'users'").get();
    return row ? JSON.parse(row.json) : [];
  };
  const platformRepository = createPlatformIdentityRepository(db, { readUsers });
  const platformScope = resolveTrustedScope({
    req: { user: { userId: 'U-billing' } },
    repository: platformRepository,
    readUsers,
    nowIso: () => '2026-09-15T12:00:00.000Z',
  });
  const service = createActualSourceEligibilityDryRunService({ db });
  const context = service.createCommandContext(platformScope);
  const result = service.evaluateActualSourceDryRun(context, command);
  process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    code: error?.code || null,
    sqliteCode: error?.code?.startsWith?.('SQLITE_') ? error.code : null,
    message: error?.message || String(error),
  })}\n`);
} finally {
  db.close();
}
