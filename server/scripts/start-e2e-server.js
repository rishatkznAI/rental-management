if (process.env.E2E_TRUSTED_SCOPE_BOOTSTRAP !== '1' || process.env.NODE_ENV !== 'test') {
  throw new Error('The E2E server entrypoint requires explicit test-only actor-scope bootstrap.');
}

const { seedE2eActorScope } = require('./seed-e2e-actor-scope');

seedE2eActorScope();
require('../server');
