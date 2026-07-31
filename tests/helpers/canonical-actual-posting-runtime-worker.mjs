import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  createCanonicalActualPostingRuntimeContract,
} = require('../../server/lib/canonical-actual-posting-domain.js');
const {
  createCanonicalActualPostingRuntimeService,
} = require('../../server/lib/canonical-actual-posting-runtime-service.js');

const input = JSON.parse(process.env.PR9C_WORKER_INPUT || '{}');
const db = new Database(input.dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 10000');
const runtimeContract = createCanonicalActualPostingRuntimeContract(input.runtimeContractInput);
const service = createCanonicalActualPostingRuntimeService({ db, runtimeContract });

function finish(message) {
  if (process.send) process.send(message, () => process.disconnect());
}

if (process.send) process.send({ type: 'ready' });
process.on('message', message => {
  if (message?.type !== 'go') return;
  try {
    finish({ result: service.postEligibleEvent(input.selector), type: 'result' });
  } catch (error) {
    finish({
      error: { code: error?.code || null, message: error?.message || String(error) },
      type: 'result',
    });
  } finally {
    db.close();
  }
});
