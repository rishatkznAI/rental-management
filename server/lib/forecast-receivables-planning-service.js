const {
  assertForecastCommandContext,
  createForecastReceivablesCommandContext,
  materializeForecastCalculationCommand,
} = require('./forecast-receivables-planning-domain');
const {
  createUnavailableForecastReceivablesPolicyRegistry,
  evaluateForecastPolicy,
} = require('./forecast-receivables-planning-policy');
const {
  createForecastReceivablesPlanningRepository,
} = require('./forecast-receivables-planning-repository');

function createForecastReceivablesPlanningService({
  db,
  repository,
  policyRegistry,
  readUsers,
  repositoryOptions,
} = {}) {
  const registry = policyRegistry || createUnavailableForecastReceivablesPolicyRegistry();
  const forecastRepository = repository || createForecastReceivablesPlanningRepository(db, {
    ...repositoryOptions,
    readUsers,
  });

  return Object.freeze({
    createCommandContext: createForecastReceivablesCommandContext,
    calculateForecastRun(context, command) {
      assertForecastCommandContext(context);
      const commandPlan = materializeForecastCalculationCommand(command);
      // All injected policy callbacks execute before repository-owned transactional
      // revalidation begins. The repository receives only a branded inert plan.
      const preparedPlan = evaluateForecastPolicy(context, commandPlan, registry);
      return forecastRepository.calculateForecastRun(context, preparedPlan);
    },
  });
}

module.exports = {
  createForecastReceivablesPlanningService,
};
