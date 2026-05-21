#!/usr/bin/env node

const seed = require('../server/scripts/seed-staging-readiness-fixtures.cjs');

if (require.main === module) {
  try {
    console.log(JSON.stringify(seed.seedStagingReadinessFixtures(), null, 2));
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 2;
  }
}

module.exports = seed;
