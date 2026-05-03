const path = require('path');

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isDemoMode(env = process.env) {
  return truthy(env.DEMO_MODE);
}

function isDemoResetAllowed(env = process.env) {
  if (!isDemoMode(env)) return false;
  if (truthy(env.DEMO_ALLOW_RESET)) return true;
  return String(env.NODE_ENV || '').trim().toLowerCase() !== 'production';
}

function assertDemoResetAllowed({ env = process.env, dbPath = env.DB_PATH } = {}) {
  if (!isDemoMode(env)) {
    throw Object.assign(new Error('Demo reset is disabled: DEMO_MODE=true is required'), { status: 403 });
  }
  if (!isDemoResetAllowed(env)) {
    throw Object.assign(new Error('Demo reset is disabled in production without DEMO_ALLOW_RESET=true'), { status: 403 });
  }

  const resolved = path.resolve(String(dbPath || ''));
  const base = path.basename(resolved).toLowerCase();
  if (!base.includes('demo') || base === 'app.sqlite') {
    throw Object.assign(new Error('Demo reset refused: DB_PATH must point to a clearly named demo database'), { status: 409 });
  }

  return true;
}

function getDemoPublicInfo(env = process.env) {
  return {
    enabled: isDemoMode(env),
    resetAllowed: isDemoResetAllowed(env),
    label: env.DEMO_LABEL || 'Демо-режим',
    message: env.DEMO_MESSAGE || 'Данные ненастоящие и могут быть сброшены.',
  };
}

module.exports = {
  assertDemoResetAllowed,
  getDemoPublicInfo,
  isDemoMode,
  isDemoResetAllowed,
};
