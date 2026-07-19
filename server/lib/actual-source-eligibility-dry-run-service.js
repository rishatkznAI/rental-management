const {
  assertActualSourceDryRunContext,
  createActualSourceDryRunContext,
  materializeActualSourceDryRunCommand,
} = require('./actual-source-eligibility-dry-run-domain');
const {
  createActualSourceEligibilityDryRunRepository,
} = require('./actual-source-eligibility-dry-run-repository');

function createActualSourceEligibilityDryRunService({ db, repository } = {}) {
  const dryRunRepository = repository || createActualSourceEligibilityDryRunRepository(db);
  return Object.freeze({
    createCommandContext: createActualSourceDryRunContext,
    evaluateActualSourceDryRun(context, command) {
      assertActualSourceDryRunContext(context);
      const commandPlan = materializeActualSourceDryRunCommand(command);
      // The command and complete versioned policy manifest are inert before any
      // repository transaction begins. No caller callback crosses BEGIN IMMEDIATE.
      const executionPlan = dryRunRepository.prepareDryRun(context, commandPlan);
      return dryRunRepository.evaluateDryRun(context, executionPlan);
    },
  });
}

module.exports = {
  createActualSourceEligibilityDryRunService,
};
