#!/usr/bin/env node

const { spawn } = require('child_process');
const os = require('os');

function firstNonEmpty(...values) {
  return values.map(value => String(value || '').trim()).find(Boolean) || '';
}

function resolveReleaseEnv(env = process.env) {
  const nextEnv = { ...env };
  const explicitReleaseType = firstNonEmpty(
    nextEnv.RELEASE_TYPE,
    nextEnv.RELEASE_PREFLIGHT_RELEASE_TYPE,
    nextEnv.RAILWAY_RELEASE_TYPE,
  );

  if (!explicitReleaseType && firstNonEmpty(nextEnv.RAILWAY_GIT_COMMIT_SHA)) {
    nextEnv.RAILWAY_RELEASE_TYPE = 'backend';
  }

  return nextEnv;
}

function start() {
  const child = spawn(process.execPath, ['server.js'], {
    stdio: 'inherit',
    env: resolveReleaseEnv(process.env),
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(128 + (os.constants.signals[signal] || 0));
      return;
    }
    process.exit(code ?? 0);
  });
}

if (require.main === module) {
  start();
}

module.exports = {
  resolveReleaseEnv,
};
