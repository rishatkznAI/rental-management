import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  createCanonicalActualPostingService,
} = require('../../server/lib/canonical-actual-posting-service.js');
const {
  createCanonicalActualPostingRepository,
} = require('../../server/lib/canonical-actual-posting-repository.js');
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
  },
);
const postingRepository = createCanonicalActualPostingRepository(
  db,
  runtimeContract,
  {
    clock: input.clockMs === undefined ? undefined : () => input.clockMs,
    hooks,
  },
);

const protocolState = {
  lockAcquired: false,
  protectedStageReached: false,
};

function protocolEvent(type, details = {}) {
  const file = input.protocolPaths?.[type];
  if (file && !fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ ...details, type }));
  }
  send({ ...details, type });
}

const originalExec = db.exec.bind(db);
const originalPrepare = db.prepare.bind(db);
db.exec = sql => {
  const statement = String(sql);
  if (/^\s*BEGIN\s+IMMEDIATE\s*;?\s*$/i.test(statement)) {
    protocolEvent('begin_immediate_attempted');
    const result = originalExec(sql);
    protocolState.lockAcquired = true;
    protocolState.protectedStageReached = false;
    protocolEvent('lock_acquired');
    return result;
  }
  const result = originalExec(sql);
  if (/^\s*(?:COMMIT|ROLLBACK)\s*;?\s*$/i.test(statement)) {
    protocolState.lockAcquired = false;
    protocolEvent('release_completed', { statement: statement.trim().toUpperCase() });
  }
  return result;
};
db.prepare = sql => {
  const statement = originalPrepare(sql);
  return new Proxy(statement, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (
        protocolState.lockAcquired
        && !protocolState.protectedStageReached
        && ['all', 'get', 'iterate', 'run'].includes(property)
      ) {
        return (...args) => {
          protocolState.protectedStageReached = true;
          protocolEvent('protected_stage_reached');
          return value.apply(target, args);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
};

send({ type: 'ready' });
process.on('message', message => {
  if (message?.type !== 'go') return;
  protocolEvent('repository_entrypoint_invoked', { entrypoint: input.entrypoint });
  const before = Number(db.prepare('SELECT total_changes() AS total').get().total);
  try {
    let result;
    if (input.entrypoint === 'seam') {
      result = eligibilityRepository.orchestratePostingDenial(input.command);
    } else if (input.entrypoint === 'wrapper') {
      result = postingRepository.post(input.command.postingCommand);
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
