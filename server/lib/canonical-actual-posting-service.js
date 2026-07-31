const {
  ERROR_CODES,
  CanonicalActualPostingError,
  DISABLED_CANONICAL_ACTUAL_POSTING_RUNTIME_CONTRACT,
  assertCanonicalActualPostingRuntimeContract,
  normalizeCanonicalPostingCommand,
} = require('./canonical-actual-posting-domain');
const {
  createCanonicalActualPostingRepository,
} = require('./canonical-actual-posting-repository');

function createCanonicalActualPostingService({
  db,
  runtimeContract = DISABLED_CANONICAL_ACTUAL_POSTING_RUNTIME_CONTRACT,
}) {
  const exactRuntimeContract = assertCanonicalActualPostingRuntimeContract(runtimeContract);
  const repository = exactRuntimeContract.enabled
    ? createCanonicalActualPostingRepository(db, exactRuntimeContract)
    : null;
  return Object.freeze({
    postCanonicalReceivable(commandInput) {
      const command = normalizeCanonicalPostingCommand(commandInput);
      if (!exactRuntimeContract.enabled) {
        throw new CanonicalActualPostingError(ERROR_CODES.PR9B_DISABLED);
      }
      return repository.post(command);
    },
  });
}

module.exports = {
  createCanonicalActualPostingService,
};
