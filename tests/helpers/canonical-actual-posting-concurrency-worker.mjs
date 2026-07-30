import { createRequire } from 'node:module';
import fs from 'node:fs';

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

function holdBarrier(phase, details) {
  const configured = input.barriers?.[phase]?.[details.stage]
    || (
      details.stage === input.barrierStage && phase === input.barrierPhase
        ? { reachedPath: input.barrierReachedPath, releasePath: input.barrierReleasePath }
        : null
    );
  if (!configured) return;
  fs.writeFileSync(configured.reachedPath, JSON.stringify({ phase, ...details }));
  send({ phase, stage: details.stage, type: 'barrier' });
  while (!fs.existsSync(configured.releasePath)) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}

const hooks = input.barrierStage || input.barriers ? {
  afterPairCommit: details => holdBarrier('after', details),
  afterRecoveryStageCommit: details => holdBarrier('after', details),
  beforePairCommit: details => holdBarrier('before', details),
  beforeRecoveryStageCommit: details => holdBarrier('before', details),
  beforeSeamSnapshotRelease: details => holdBarrier('snapshot', details),
} : undefined;
const eligibilityRepository = createCanonicalActualEligibilityEventRepository(
  db,
  runtimeContract,
  {
    clock: input.clockMs === undefined ? undefined : () => input.clockMs,
    hooks,
    testOnlyBuildPostingDenialPackage: input.entrypoint === 'wrapper',
  },
);

send({ type: 'ready' });
process.on('message', message => {
  if (message?.type !== 'go') return;
  send({ type: 'attempting' });
  const before = Number(db.prepare('SELECT total_changes() AS total').get().total);
  try {
    let result;
    if (input.entrypoint === 'seam') {
      result = eligibilityRepository.orchestratePostingDenial(input.command);
    } else if (input.entrypoint === 'wrapper') {
      const packageValue = eligibilityRepository.__testBuildPostingDenialPackage({
        deniedAttemptedAt: input.deniedAttemptedAt,
        seamCommand: input.command,
      });
      const wrapper = eligibilityRepository.persistDenialEvidence(packageValue);
      const pair = eligibilityRepository.readConflictPair(wrapper.conflict.transitionId);
      result = {
        conflict: wrapper.conflict,
        replayed: wrapper.replayed,
        stage: pair.transition.state,
      };
    } else if (input.entrypoint === 'reconcile') {
      result = eligibilityRepository.reconcileTransition(input.command.transitionId);
    } else {
      result = service.postCanonicalReceivable(input.command);
    }
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
