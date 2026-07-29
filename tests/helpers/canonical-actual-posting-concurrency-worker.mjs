import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  createCanonicalActualPostingService,
} = require('../../server/lib/canonical-actual-posting-service.js');
const {
  createCanonicalActualEligibilityEventRepository,
} = require('../../server/lib/canonical-actual-eligibility-event-repository.js');
const {
  createCanonicalActualPostingRuntimeContract,
} = require('../../server/lib/canonical-actual-posting-domain.js');

function send(message) {
  if (process.send) process.send(message);
}

function finish(message) {
  if (process.send) {
    process.send(message, () => process.disconnect());
  }
}

const input = JSON.parse(process.env.PR9B_WORKER_INPUT || '{}');
const db = new Database(input.dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 10000');
const runtimeContract = createCanonicalActualPostingRuntimeContract(input.runtimeContractInput);
const service = createCanonicalActualPostingService({ db, runtimeContract });
const eligibilityRepository = createCanonicalActualEligibilityEventRepository(db, runtimeContract);

send({ type: 'ready' });
process.on('message', message => {
  if (message?.type !== 'go') return;
  const before = Number(db.prepare('SELECT total_changes() AS total').get().total);
  try {
    const result = input.entrypoint === 'seam'
      ? eligibilityRepository.orchestratePostingDenial(input.command)
      : service.postCanonicalReceivable(input.command);
    const after = Number(db.prepare('SELECT total_changes() AS total').get().total);
    finish({ dml: after - before, result, type: 'result' });
  } catch (error) {
    const after = Number(db.prepare('SELECT total_changes() AS total').get().total);
    finish({
      dml: after - before,
      error: { code: error?.code || null, message: error?.message || String(error) },
      type: 'result',
    });
  } finally {
    db.close();
  }
});
