const {
  ERROR_CODES,
  CanonicalActualPostingError,
  assertCanonicalActualPostingRuntimeContract,
  assertExactObjectKeys,
  assertIdentifier,
  materializeInert,
} = require('./canonical-actual-posting-domain');
const {
  createCanonicalActualEligibilityEventRepository,
} = require('./canonical-actual-eligibility-event-repository');
const {
  createCanonicalActualPostingAuthorityRepository,
} = require('./canonical-actual-posting-authority-repository');
const {
  createCanonicalActualPostingService,
} = require('./canonical-actual-posting-service');

const RUNTIME_SELECTOR_KEYS = Object.freeze(['branchId', 'companyId', 'eventId']);

function normalizeRuntimeSelector(input) {
  const selector = materializeInert(input, 'runtimeSelector');
  assertExactObjectKeys(selector, RUNTIME_SELECTOR_KEYS, 'runtimeSelector');
  for (const field of RUNTIME_SELECTOR_KEYS) assertIdentifier(selector[field], field);
  return Object.freeze(selector);
}

function createCanonicalActualPostingRuntimeService({ db, runtimeContract }) {
  if (!db) throw new TypeError('Canonical actual posting runtime requires a database.');
  const exactRuntimeContract = assertCanonicalActualPostingRuntimeContract(runtimeContract);
  const eligibilityRepository = createCanonicalActualEligibilityEventRepository(db, exactRuntimeContract);
  const authorityRepository = createCanonicalActualPostingAuthorityRepository(db);
  const postingService = createCanonicalActualPostingService({ db, runtimeContract: exactRuntimeContract });

  function postEligibleEvent(selectorInput) {
    const selector = normalizeRuntimeSelector(selectorInput);
    if (!exactRuntimeContract.enabled) {
      throw new CanonicalActualPostingError(ERROR_CODES.PR9B_DISABLED);
    }

    const event = eligibilityRepository.readEventById(selector.eventId);
    if (
      !event
      || event.companyId !== selector.companyId
      || event.branchId !== selector.branchId
    ) {
      throw new CanonicalActualPostingError(ERROR_CODES.POSTING_EVENT_NOT_FOUND);
    }
    const activation = authorityRepository.readActivationRecord(event.activationRecordId);
    if (!activation) {
      throw new CanonicalActualPostingError(ERROR_CODES.POSTING_INTEGRITY_BLOCKED);
    }

    const posting = postingService.postCanonicalReceivable({
      companyId: event.companyId,
      branchId: event.branchId,
      eventId: event.id,
      operationType: 'canonical_receivable.initial_post.v1',
      assertedEventHash: event.eventHash,
      assertedWriteAuthorizationRecordId: event.writeAuthorizationRecordId,
      requestedActivationRecordId: event.activationRecordId,
      requestedSourceAdapterAuthorityRecordId: event.sourceAdapterAuthorityRecordId,
      requestedPostingAdapterAuthorityRecordId: activation.postingAdapterAuthorityRecordId,
      requestedPostingAdapterAuthorityVersion: activation.postingAdapterAuthorityVersion,
      requestedPostingAdapterAuthorityRecordHash: activation.postingAdapterAuthorityRecordHash,
      assertedDueDatePolicySetHash: event.dueDatePolicySetHash,
      assertedSelectedDueDateGateKind: event.selectedDueDateGateKind,
      assertedSelectedDueDatePolicyId: event.selectedDueDatePolicyId,
      assertedSelectedDueDatePolicyVersion: event.selectedDueDatePolicyVersion,
      assertedSelectedDueDatePolicyHash: event.selectedDueDatePolicyHash,
      assertedDueDateTreatment: event.dueDateTreatment,
      assertedUnknownDueDateTreatmentMappingId: event.unknownDueDateTreatmentMappingId,
      assertedUnknownDueDateTreatmentMappingVersion: event.unknownDueDateTreatmentMappingVersion,
      assertedUnknownDueDateTreatmentMappingHash: event.unknownDueDateTreatmentMappingHash,
    });

    return Object.freeze({
      event: Object.freeze({
        branchId: event.branchId,
        companyId: event.companyId,
        eventHash: event.eventHash,
        eventId: event.id,
      }),
      posting,
    });
  }

  return Object.freeze({ postEligibleEvent });
}

module.exports = {
  RUNTIME_SELECTOR_KEYS,
  createCanonicalActualPostingRuntimeService,
  normalizeRuntimeSelector,
};
