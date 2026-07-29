import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  createCanonicalActualEligibilityEventService,
} = require('../../server/lib/canonical-actual-eligibility-event-service.js');
const {
  createCanonicalActualPostingRuntimeContract,
} = require('../../server/lib/canonical-actual-posting-domain.js');

const db = new Database(workerData.dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
try {
  const runtimeContract = createCanonicalActualPostingRuntimeContract(workerData.runtimeContractInput);
  const service = createCanonicalActualEligibilityEventService({ db, runtimeContract });
  const result = service.produceEligibleEvent(workerData.command);
  parentPort.postMessage({ ok: true, replayed: result.replayed, id: result.event.id });
} catch (error) {
  parentPort.postMessage({ ok: false, code: error?.code || null, message: error?.message || String(error) });
} finally {
  db.close();
}
