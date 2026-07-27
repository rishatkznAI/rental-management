const {
  ELIGIBILITY_COMMAND_KEYS,
  createCanonicalActualEligibilityEventRepository,
} = require('./canonical-actual-eligibility-event-repository');
const {
  DISABLED_CANONICAL_ACTUAL_POSTING_RUNTIME_CONTRACT,
  assertCanonicalActualPostingRuntimeContract,
  assertExactObjectKeys,
  assertIdentifier,
  materializeInert,
} = require('./canonical-actual-posting-domain');

function validateEligibilityEventCommand(command) {
  const inert = materializeInert(command, 'command');
  assertExactObjectKeys(inert, ELIGIBILITY_COMMAND_KEYS, 'command');
  for (const field of ELIGIBILITY_COMMAND_KEYS) assertIdentifier(inert[field], field);
  return inert;
}

function createCanonicalActualEligibilityEventService({
  db,
  runtimeContract = DISABLED_CANONICAL_ACTUAL_POSTING_RUNTIME_CONTRACT,
}) {
  const repository = createCanonicalActualEligibilityEventRepository(
    db,
    assertCanonicalActualPostingRuntimeContract(runtimeContract),
  );
  return Object.freeze({
    produceEligibleEvent(command) {
      return repository.produceEligibleEvent(validateEligibilityEventCommand(command));
    },
  });
}

module.exports = {
  createCanonicalActualEligibilityEventService,
  validateEligibilityEventCommand,
};
