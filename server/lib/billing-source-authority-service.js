const {
  createBillingSourceCommandContext,
  materializeBillingSourceCommandPlan,
} = require('./billing-source-authority-domain');
const {
  createBillingSourceAuthorityRepository,
} = require('./billing-source-authority-repository');

function createBillingSourceAuthorityService({ db, repository } = {}) {
  const sourceRepository = repository || createBillingSourceAuthorityRepository(db);

  function execute(method, operationType, context, input) {
    const plan = materializeBillingSourceCommandPlan(input, operationType);
    return sourceRepository[method](context, plan);
  }

  return Object.freeze({
    createCommandContext: createBillingSourceCommandContext,
    closeBillingPeriod(context, input) {
      return execute('closeBillingPeriod', 'close_billing_period', context, input);
    },
    reopenBillingPeriod(context, input) {
      return execute('reopenBillingPeriod', 'reopen_billing_period', context, input);
    },
    formUpd(context, input) {
      return execute('formUpd', 'form_upd', context, input);
    },
    recordUpdCoverage(context, input) {
      return execute('recordUpdCoverage', 'record_upd_coverage', context, input);
    },
    conductUpd(context, input) {
      return execute('conductUpd', 'conduct_upd', context, input);
    },
    correctUpd(context, input) {
      return execute('correctUpd', 'correct_upd', context, input);
    },
  });
}

module.exports = {
  createBillingSourceAuthorityService,
};
