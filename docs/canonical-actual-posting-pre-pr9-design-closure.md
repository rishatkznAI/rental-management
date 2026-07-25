# PRE-PR9 Design Closure: Canonical Actual Posting Foundation v1

## 1. Status and safety boundary

**Document status:** `DESIGN CLOSURE BLOCKED — OWNER DECISION PACKET READY`

**Design-only audit timestamp:** `2026-07-25T16:35:40Z`

**Repository:** `rishatkznAI/rental-management`

**Audited base:** `9870c279166e41dc0a059763240a8ce892abf54d`

This document is an exact, implementation-ready **recommendation** for PR9. It is
not an approval record and does not implement, authorize, deploy or activate PR9.
Every D-PR9 decision remains `BLOCKED` because no durable owner approval of this
exact proposal was supplied. The owner packet in section 22 permits a later explicit
decision without exposing credentials or accessing production.

The required authorization state remains:

```text
foundationDeploymentRetryAuthorized = FALSE
productionActivationAuthorized = FALSE
canonicalProductionReadsAuthorized = FALSE
productionCanonicalWritesAuthorized = FALSE
pr9ImplementationAuthorized = FALSE
```

Merging this design document, passing CI, or receiving no objection changes none of
those values. PR9 implementation requires a later, separately recorded
`pr9ImplementationAuthorized = TRUE` decision after every prerequisite gate is
satisfied. Disabled deployment, production activation, canonical reads, canonical
writes, settlement, shadow reads and cutover remain separate later decisions.

## 2. Live base and chronology audit

At the audit timestamp:

- local `HEAD`, local `origin/main`, and the GitHub default-branch head all equal
  `9870c279166e41dc0a059763240a8ce892abf54d`;
- the worktree was clean before the docs-only branch was created;
- PR5 implementation #210 is merged as `35aa9891e389ab7de114475f7012d737d1165695`;
- PR6 implementation #212 is merged as `485808d24b8c5f6481e0520eec5c8985b71ffeab`;
- PR7 implementation #214 is merged as `cb90e09f26c5b9916a4818fd96048070a6a1a662`;
- PR8 implementation #216 is merged as `afeac4de9b2711d9c6493855a8e3632443844f61`;
- PRE-PR9 proposal #218 is merged as
  `7892ea68193fa5357733ca0d554dc84af82e6200` but explicitly approves no PR9
  decision;
- deployment incident record #227 is merged as
  `8dc34629acdae6d959797873d4e66ad62a66eb46`;
- rollback/retry record #228 is merged as
  `36840ea2e1360c539aa5e34ef392f4232b1b4327`;
- security/backup remediation #229 is merged as
  `32ce9cb5d9027bfb75034b3f436c4fcf85d703be`;
- credential-supersession plan #230 is the audited base
  `9870c279166e41dc0a059763240a8ce892abf54d`;
- those later records supersede the old production fact that PR5–PR8 schema was
  absent, without granting any new authorization.

The current evidence chronology is:

1. PR5–PR8 DDL was applied to production during the controlled foundation attempt.
2. Application runtime was rolled back to PR3 source
   `6a38582f5f90b85734884b6b12ad8e306b24619e` and pinned image
   `sha256:c27f43d5520f63415203e0cafdb23c07d4d93ec3d93e0236af4917dfbcae9650`.
3. The additive PR5–PR8 schema and seven migration registrations remain.
4. PR5 authority/bootstrap rows, all 16 PR6 rows, all 8 PR7 rows, all 8 PR8 rows,
   and all canonical/settlement rows remain zero.
5. Capability catalog state remains exactly one active v1 manifest with 11 entries.
6. The post-rollback shadow migration baseline is
   `documents_gantt_shadow_indexes.applied_at = 2026-07-25 14:19:55`.
7. PR #229 proves old registry credential revocation, the rollback runtime and a new
   coherent encrypted backup; no replacement credential exists.
8. PR #230 defines only a future credential-supersession plan. Railway remains
   `repo = null`, `image = null`; no retry is authorized.

This design used repository and GitHub metadata only. Railway was not called and no
production data was accessed.

## 3. Existing boundaries that PR9 must preserve

### PR1–PR3

- PR1 owns `canonical_companies`, `canonical_branches`,
  `canonical_receivables`, `financial_audit_events` and the generic canonical
  domain contract.
- PR2 owns settlement tables and approval workflows. PR9 never writes or invokes
  payment, allocation, adjustment, refund, reversal, write-off or settlement paths.
- PR3 owns default-disabled GET-only canonical reads. The production scope resolver
  remains unconditional `null`; PR9 does not enable or modify it.

### PR5

- `canonical_companies` and `canonical_branches` remain the only physical scope
  roots.
- Human authorization remains exact v1 catalog, membership, template, grant/deny
  and fresh-scope logic.
- PR5 supports only human principals. A human membership, display role,
  Administrator label or `receivables.read` cannot become a PR9 integration
  identity.

### PR6

- The complete 16-table Billing Source Authority universe is the only economic and
  source lineage for actual eligibility.
- Closed period, current conducted UPD, stable UPD line, validated active coverage,
  exact net/VAT/gross reconciliation and correction lineage remain mandatory.
- `app_data`, generic rentals/documents/payments, names, labels, array positions and
  mutable totals are forbidden fallback sources.

### PR7

- Forecast is planning-only and is never a PR9 input.
- PR9 may not import, query or reference a `forecast_receivable_` table, run, item,
  amount, due date or status.

### PR8

- PR8 is sealed diagnostic evidence only.
- `diagnosticOnly = 1`, `canonicalWriteAuthorized = 0` and
  `productionActivationAuthorized = 0` remain true and are never reinterpreted.
- A future producer may use a sealed `eligible_candidate` only after separate
  acceptance and fresh PR6/policy/authority revalidation.

## 4. Proposed PR9 boundary

The recommended future flow is exactly:

```text
accepted sealed PR8 candidate
  -> repository-owned ActualReceivableEligibleV1
  -> fresh locked source/authority/authorization/activation validation
  -> direct posted canonical_receivables row
  -> sealed CanonicalPostingOperationV1
  -> repository-derived financial_audit_events row
```

PR9 is forward-only and never performs historical import, partial-period trimming,
backfill, dual write, forecast conversion, settlement, correction or consumer
switching. Future production-reachable code is forbidden; only the PR9 schema
initializer may become reachable from `server/db.js`, immediately after PR8.

## 5. Common v1 serialization, identity and limits

All proposed contracts use these rules:

- schema names and enum values are exact case-sensitive ASCII strings;
- identifiers are non-empty opaque UTF-8 strings, 1–160 bytes, with no trimming or
  Unicode normalization after validation;
- hashes are lowercase 64-character SHA-256 hex;
- timestamps are repository-owned RFC3339 UTC with millisecond precision;
- civil dates are exact valid `YYYY-MM-DD` dates in the PR5 company IANA timezone;
- money is RUB safe-integer kopecks in `[0, 9007199254740991]`;
- authoritative objects are deeply inert plain JSON: no proxies, accessors,
  symbols, custom prototypes, `toJSON`, cycles, sparse arrays, bigint, undefined,
  non-finite/floating numbers or secret-bearing keys;
- canonical JSON recursively sorts ASCII object keys by byte order, preserves array
  order defined by each contract, emits no insignificant whitespace, does not
  normalize string content, and encodes as UTF-8;
- every content hash is `sha256(canonicalJson(hashEnvelope))` where the exact
  envelope is listed by the contract;
- generated row IDs and repository timestamps are excluded from business identity
  unless the contract explicitly lists them;
- input maximum is 262,144 canonical UTF-8 bytes, depth 24 and 10,000 nodes;
- retained JSON evidence may contain stable IDs, hashes, enum decisions and numeric
  counts only. Names, contacts, addresses, free-form messages, credentials, tokens,
  cookies, sessions and authorization headers are forbidden.

## 6. D-PR9-01 — Amount basis

**Status:** `BLOCKED — OWNER/ACCOUNTANT/TAX APPROVAL REQUIRED`

**Recommended decision:** `canonical_receivables.originalAmountMinor` equals the
exact PR8 candidate `sourceGrossMinor`. Currency is `RUB`; arithmetic is integer
kopecks only. The eligible event carries all three components and requires
`netAmountMinor + vatAmountMinor = grossAmountMinor`. The canonical target stores
gross in `originalAmountMinor`; net and VAT remain immutable event/operation/audit
evidence because PR1 has no separate canonical net/VAT columns.

The approved amount policy identity must be exactly:

```text
policyKind = canonical_original_amount_basis
policyVersion = 1
basis = gross
currency = RUB
rounding = source_authority_exact_no_recalculation
```

Its decision reference and hash are included in the PR8 policy manifest, eligibility
event, write authorization, activation and posting operation. Callers cannot select
or override the basis. PR9 performs no rounding; it accepts only the exact PR6/PR8
integer result and zero-delta reconciliation.

**Rationale:** gross is the customer-facing conducted UPD obligation and maps to the
single PR1 amount column without dropping VAT. Net would understate the payable
amount; recomputation would create a second tax/rounding authority.

**Alternatives rejected by recommendation:** net; caller-selected basis; runtime
recalculation; float conversion; tolerance.

**Failure:** missing/mismatched policy or `proposedOriginalAmountMinor !=
sourceGrossMinor` blocks event production/posting and creates no canonical row.

**Compatibility/security/audit:** PR1 schema remains unchanged; event and operation
preserve net/VAT/gross and policy hash. Exact policy matching is repeated inside the
posting transaction.

## 7. D-PR9-02 — Due date

**Status:** `BLOCKED — OWNER/ACCOUNTANT/LEGAL APPROVAL REQUIRED`

**Recommended decision:** `dueDateProvenance=unknown` may be eligible and may be
posted only when the approved PR8 `unknown_due_date_treatment` gate explicitly says
`post_without_aging_v1`. It maps to `contractualDueDate = NULL` and
`dueDateProvenance = unknown`. Such a row remains outside aging, overdue,
collections and legal escalation.

Accepted proven provenance values are exactly:

- `invoice_due_date`;
- `contractual_payment_due_date`;
- `installment_due_date`;
- `unknown` under the rule above.

`calculated`, `expected`, `signed`, rental end/return, promise, collection-plan and
unverified imported dates are forbidden. `migrated_verified` remains a PR1 legacy
vocabulary value but is forbidden for forward-only PR9.

Due-date identity envelope is:

```text
{ dueDateProvenance, contractualDueDate, dueDateEvidenceRef,
  dueDatePolicyRef, dueDatePolicyVersion, dueDatePolicyHash }
```

For `unknown`, the date and evidence ref are null and the explicit unknown-policy
reference/hash are required. For proven dates, date and evidence ref are required.
The envelope participates in `actualSourceKey`, `eventHash`, idempotency and posting
result hash.

A different due date/provenance/evidence under the same source slice is a P0
conflict, not a second receivable. A later proven date requires the separately
approved PR2 due-date-change workflow; PR9 never updates it.

## 8. D-PR9-03 — Conducted, signature and evidence authority

**Status:** `BLOCKED — ACCOUNTANT/LEGAL/SOURCE-OWNER APPROVAL REQUIRED`

**Recommended decision:** the source is admissible only when all conditions hold:

1. referenced PR6 period current version is `closed` and has no later reopen;
2. referenced UPD has a `formed` version and its exact current latest version is
   `conducted`;
3. no later `cancelled`, `corrected` or superseding version/coverage relation exists;
4. coverage set is current active `validated`, contains the exact candidate slice,
   and has no lifecycle successor;
5. PR6 snapshot evidence contains the exact required types
   `calculation_policy`, `contract`, `effective_terms`, `rental`,
   `rounding_policy`, `vat_policy`;
6. conducted evidence supplies immutable source event ID/version, occurred-at UTC,
   source system, content hash and `signatureRequirementPolicyRef`;
7. signature is orthogonal: `signed` never implies `conducted`;
8. when the exact policy says `required`, immutable signature evidence ID/version,
   signed-at and hash must exist; when it says `not_required`, no synthetic
   signature evidence is created.

Evidence hash envelope contains exact source kind/ID/version, event ID/version,
company/branch, covered interval, authority status, policy reference and immutable
content hash. Labels, filenames, display states, names, mutable document totals and
timestamps without source event lineage confer no authority.

Any missing, ambiguous, changed, reopened, cancelled, corrected or superseded state
blocks before canonical DML.

## 9. D-PR9-04 — Source system and adapter

**Status:** `BLOCKED — SOURCE/SECURITY/OPERATIONS OWNER APPROVAL REQUIRED`

**Recommended v1 logical source system:** exactly
`rentcore.billing_source_authority.v1`.

The canonical row never identifies a mutable upstream directly. Concrete upstream
systems are allow-listed in one active `GovernedAdapterAuthorityV1` source-adapter
record per company and branch, while the canonical projection records the stable PR6
authority boundary above. PR6 ownership manifests must show that every source-owned
row belongs to an upstream ID allowed by that contract. No wildcard is valid.

The source adapter contract binds exact owner, company, branch, upstream IDs, row
classes, event/schema versions, artifact digest, commit SHA, configuration hash,
policy hash, effective interval and revocation lineage. `app_data`, generic rentals,
generic documents, payments, labels and PR7 forecast are expressly forbidden.

No concrete production adapter instance is approved or created by this document.

## 10. D-PR9-05 — Integration identity

**Status:** `BLOCKED — SECURITY/OPERATIONS/ADAPTER OWNER APPROVAL REQUIRED`

**Recommended same-process v1 identities:**

- eligibility producer authority ID:
  `rentcore.actual-receivable-eligibility-producer.production.v1`;
- producer actor ID:
  `integration:rentcore-actual-receivable-eligibility-producer`;
- posting adapter authority ID:
  `rentcore.canonical-receivable-posting.production.v1`;
- posting actor ID:
  `integration:rentcore-canonical-receivable-posting`.

V1 is an in-process repository component and uses
`credentialType = none_same_process_repository_owned`. There is no bearer credential
or human session; `credentialFingerprint = NULL` is mandatory for that enum. Identity
comes from an immutable active authority record matching environment, exact
artifact digest, commit SHA, configuration hash, policy hashes, company, branch and
operation. Every authority record has explicit `effectiveFrom` and required
`expiresAt`, with maximum lifetime 24 hours. Renewal appends a new version; revocation
appends a new terminal version.

An out-of-process adapter, bearer token or long-lived secret requires a new schema
version. Human memberships, Administrator, generic `system`, headers, request body
and session permissions cannot select an integration actor.

Inside `BEGIN IMMEDIATE`, the repository rereads the latest authority version and
denies expired, revoked, superseded, ambiguous or artifact/config/policy-drifted
identity. Revocation after planning but before lock denies. Revocation after commit
blocks future attempts and preserves history.

## 11. D-PR9-06 — Capability catalog strategy

**Status:** `BLOCKED — SECURITY/IDENTITY OWNER APPROVAL REQUIRED`

**Recommended strategy:** option A. PR9 adds no capability catalog version and no
human capability. Integration operations are authorized exclusively by
`GovernedAdapterAuthorityV1`, `CanonicalWriteAuthorizationV1` and
`CanonicalPostingActivationV1` outside `company_memberships`.

Capability catalog remains exactly one active v1 manifest with 11 entries. PR5–PR8
structural assertions, catalog checksums, role templates and human freshness checks
remain byte-for-byte compatible. `receivables.read` continues to authorize neither
evaluation, event production, posting, activation nor reconciliation acceptance.

Options B and C are rejected for v1 because adding a second active catalog would
fail current PR5–PR8 structure/freshness assertions and a coordinated catalog
upgrade would broaden the PR9 security/migration scope. Any future human management
UI/API or out-of-process integration resolver requires a separate catalog-design PR.

## 12. D-PR9-07 — Activation boundary and cohort

**Status:** `BLOCKED — PRODUCT/FINANCE/LEGAL/OPERATIONS APPROVAL REQUIRED`

**Recommended immutable v1 definition:** one activation record covers exactly one
company, one concrete branch, the source system
`rentcore.billing_source_authority.v1`, currency `RUB`, source class
`conducted_upd_validated_coverage_slice_v1`, and half-open source period with
`sliceStartDate >= forwardOnlyStartDate`. It has no wildcard and no partial-period
trimming.

Allowed document/rental classes are exactly `rental_service_upd` and
`equipment_rental_line`; all sales, service repair, delivery, leasing, payroll,
advance, payment, forecast and historical/imported classes are excluded.

`cohortHash` is SHA-256 of:

```text
{ schemaVersion, companyId, branchId, sourceSystemIds,
  allowedDocumentClasses, allowedRentalClasses, currency,
  forwardOnlyStartDate, explicitExclusions, policyManifestHashes }
```

`boundaryHash` is SHA-256 of:

```text
{ schemaVersion, companyId, branchId, forwardOnlyStartDate,
  sourceSystemIds, sourceClass, currency }
```

The activation has an explicit UTC effective/expiry window not exceeding 24 hours.
Change, renewal, expansion, revocation or supersession appends a new version and
requires a new accepted evidence pack and write authorization. No production value
or activation record is created here.

## 13. D-PR9-08 — Accepted PR8 evidence

**Status:** `BLOCKED — FINANCE/LEGAL/INDEPENDENT REVIEW APPROVAL REQUIRED`

**Recommended admission contract:** an admissible run must be a real production PR8
run created under an approved policy/source/adapter/activation scope and satisfy:

- exact `status = completed`;
- `candidateCount > 0`, `blockedCandidateCount = 0`;
- complete sealed operation and audit links;
- all run/input/candidate/check/reconciliation/diagnostic counts and hashes match
  persisted relational reconstruction;
- every relevant reconciliation has zero net, VAT and gross delta;
- candidate is `eligible_candidate`, has no blocker codes and matches the approved
  cohort before the run begins;
- run, candidate, result, input-set, policy-manifest and source-ownership hashes are
  explicitly listed in an independently signed acceptance record;
- no post-result manual exclusion or aggregate netting is allowed;
- event production begins no later than 15 minutes after `finalizedAt` and still
  rereads all current PR6 state under lock;
- the evidence pack names environment, deployment/artifact, DB identity, capture
  time, tool/query class, reviewer and exact SHA-256 pack hash.

Fixtures, tests, local SQLite, manually built JSON and this document are never
production evidence. `diagnosticOnly = true` and `canonicalWriteAuthorized = false`
remain unchanged. Acceptance authorizes only event eligibility under its exact scope;
it does not authorize canonical posting.

## 14. D-PR9-09 — Exact database object set

**Status:** `BLOCKED — ARCHITECTURE/DATABASE/SECURITY APPROVAL REQUIRED`

**Recommended migration:**

```text
migration ID = canonical_actual_posting_pr9
version = 1
```

Prerequisites are exact registered and structurally valid PR1 v1, PR2 v1, PR5 v1,
PR6 v1, PR7 v1 and PR8 v1, `foreign_keys = 1`, clean `foreign_key_check`, exact
catalog v1/11, no competing roots and no partial PR9 objects. First application also
requires zero rows in all canonical/settlement business tables and all PR5–PR8
business tables; registered rerun does not require zero rows and validates structure
read-only.

The exact PR9 table set is six tables:

### `governed_adapter_authority_records`

Columns:

```text
recordId TEXT PRIMARY KEY
authorityId TEXT NOT NULL
authorityVersion INTEGER NOT NULL
previousRecordId TEXT NULL
adapterKind TEXT NOT NULL
status TEXT NOT NULL
environment TEXT NOT NULL
actorId TEXT NOT NULL
companyId TEXT NOT NULL
branchId TEXT NOT NULL
sourceSystemIdsJson TEXT NOT NULL
sourceRowClassesJson TEXT NOT NULL
allowedOperation TEXT NOT NULL
artifactDigest TEXT NOT NULL
sourceCommitSha TEXT NOT NULL
configurationHash TEXT NOT NULL
policyHash TEXT NOT NULL
credentialType TEXT NOT NULL
credentialFingerprint TEXT NULL
credentialIssuerRef TEXT NULL
effectiveFrom TEXT NOT NULL
expiresAt TEXT NOT NULL
ownerRef TEXT NOT NULL
approvalRef TEXT NOT NULL
approvalHash TEXT NOT NULL
revocationReasonCode TEXT NULL
recordHash TEXT NOT NULL
schemaVersion INTEGER NOT NULL
createdAt TEXT NOT NULL
```

Enums: adapter kind is `source_adapter`, `eligibility_producer` or
`canonical_posting_adapter`; status is `authorized`, `revoked`, `expired` or
`superseded`; environment is `production`; allowed operation is exact for the kind.
Unique keys: `(authorityId, authorityVersion)`, `recordHash`.
Composite FKs: `(companyId, branchId)` to canonical branches; `previousRecordId` to
the same table. Checks enforce version sequence inputs, hashes, concrete branch,
JSON arrays, time order and credential nullability.

### `canonical_write_authorization_records`

Columns:

```text
recordId TEXT PRIMARY KEY
authorizationId TEXT NOT NULL
authorizationVersion INTEGER NOT NULL
previousRecordId TEXT NULL
status TEXT NOT NULL
companyId TEXT NOT NULL
branchId TEXT NOT NULL
activationBoundaryId TEXT NOT NULL
activationCohortRef TEXT NOT NULL
cohortHash TEXT NOT NULL
boundaryHash TEXT NOT NULL
sourceSystemIdsJson TEXT NOT NULL
producerAuthorityRecordId TEXT NOT NULL
postingAuthorityRecordId TEXT NOT NULL
eventSchemaVersion TEXT NOT NULL
operationType TEXT NOT NULL
allowedTablesJson TEXT NOT NULL
forbiddenOperationsJson TEXT NOT NULL
policyManifestHashesJson TEXT NOT NULL
evidencePackHash TEXT NOT NULL
acceptedDryRunIdsJson TEXT NOT NULL
acceptedDryRunResultHashesJson TEXT NOT NULL
amountBasisPolicyRef TEXT NOT NULL
amountBasisPolicyHash TEXT NOT NULL
dueDatePolicyRef TEXT NOT NULL
dueDatePolicyHash TEXT NOT NULL
operationalControlRef TEXT NOT NULL
retentionControlRef TEXT NOT NULL
backupEvidenceRef TEXT NOT NULL
approvalSetJson TEXT NOT NULL
effectiveFrom TEXT NOT NULL
expiresAt TEXT NOT NULL
revocationReasonCode TEXT NULL
recordHash TEXT NOT NULL
schemaVersion INTEGER NOT NULL
createdAt TEXT NOT NULL
```

Status is `authorized`, `revoked`, `expired` or `superseded`; operation is exactly
`canonical_receivable.initial_post.v1`; allowed tables are exactly sorted
`canonical_receivable_posting_operations`, `canonical_receivables`,
`financial_audit_events`. Unique keys: `(authorizationId, authorizationVersion)`,
`recordHash`. Composite scope FKs plus FKs to producer/posting authority records and
PR6 activation boundary are mandatory.

### `canonical_posting_activation_records`

Columns:

```text
recordId TEXT PRIMARY KEY
activationId TEXT NOT NULL
activationVersion INTEGER NOT NULL
previousRecordId TEXT NULL
status TEXT NOT NULL
companyId TEXT NOT NULL
branchId TEXT NOT NULL
activationBoundaryId TEXT NOT NULL
forwardOnlyStartDate TEXT NOT NULL
sourceSystemIdsJson TEXT NOT NULL
allowedDocumentClassesJson TEXT NOT NULL
allowedRentalClassesJson TEXT NOT NULL
currency TEXT NOT NULL
explicitExclusionsJson TEXT NOT NULL
cohortHash TEXT NOT NULL
boundaryHash TEXT NOT NULL
policyManifestHashesJson TEXT NOT NULL
writeAuthorizationRecordId TEXT NOT NULL
effectiveFrom TEXT NOT NULL
expiresAt TEXT NOT NULL
approvalRef TEXT NOT NULL
approvalHash TEXT NOT NULL
revocationReasonCode TEXT NULL
recordHash TEXT NOT NULL
schemaVersion INTEGER NOT NULL
createdAt TEXT NOT NULL
```

Unique keys: `(activationId, activationVersion)`, `recordHash`. Scope/PR6 boundary
and write-authorization FKs are mandatory.

### `actual_receivable_eligible_events`

Columns:

```text
id TEXT PRIMARY KEY
companyId TEXT NOT NULL
branchId TEXT NOT NULL
actualSourceKey TEXT NOT NULL
eventSchemaVersion TEXT NOT NULL
eventVersion INTEGER NOT NULL
dryRunId TEXT NOT NULL
candidateId TEXT NOT NULL
candidateResultHash TEXT NOT NULL
completeInputSetHash TEXT NOT NULL
policyManifestHash TEXT NOT NULL
sourceOwnershipManifestHash TEXT NOT NULL
activationBoundaryId TEXT NOT NULL
activationRecordId TEXT NOT NULL
activationCohortRef TEXT NOT NULL
cohortHash TEXT NOT NULL
periodId TEXT NOT NULL
closedPeriodVersionId TEXT NOT NULL
snapshotId TEXT NOT NULL
updId TEXT NOT NULL
formedUpdVersionId TEXT NOT NULL
conductedUpdVersionId TEXT NOT NULL
updLineId TEXT NOT NULL
updLineVersionId TEXT NOT NULL
coverageSetId TEXT NOT NULL
coverageSliceId TEXT NOT NULL
clientId TEXT NOT NULL
contractId TEXT NULL
rentalId TEXT NOT NULL
rentalLineId TEXT NOT NULL
sliceStartDate TEXT NOT NULL
sliceEndDateExclusive TEXT NOT NULL
currency TEXT NOT NULL
netAmountMinor INTEGER NOT NULL
vatAmountMinor INTEGER NOT NULL
grossAmountMinor INTEGER NOT NULL
originalAmountMinor INTEGER NOT NULL
amountBasis TEXT NOT NULL
amountBasisPolicyRef TEXT NOT NULL
amountBasisPolicyHash TEXT NOT NULL
contractualDueDate TEXT NULL
dueDateProvenance TEXT NOT NULL
dueDateEvidenceRef TEXT NULL
dueDatePolicyRef TEXT NOT NULL
dueDatePolicyHash TEXT NOT NULL
producerAuthorityRecordId TEXT NOT NULL
writeAuthorizationRecordId TEXT NOT NULL
sourceLineageHash TEXT NOT NULL
correlationId TEXT NOT NULL
eventHash TEXT NOT NULL
schemaVersion INTEGER NOT NULL
occurredAt TEXT NOT NULL
createdAt TEXT NOT NULL
```

Unique keys: `(companyId, actualSourceKey)`, `(companyId, eventHash)`, and exact
`(dryRunId, candidateId)`. Composite FKs connect candidate/run/scope, activation,
producer authority, write authorization, PR6 activation boundary and exact PR6
lineage. Checks enforce `ActualReceivableEligibleV1`, version 1, RUB,
net+VAT=gross, original=gross, half-open interval and due-date rules.

### `canonical_receivable_posting_operations`

Columns:

```text
id TEXT PRIMARY KEY
companyId TEXT NOT NULL
branchId TEXT NOT NULL
operationType TEXT NOT NULL
idempotencyKey TEXT NOT NULL
eventId TEXT NOT NULL
eventHash TEXT NOT NULL
actualSourceKey TEXT NOT NULL
postingAuthorityRecordId TEXT NOT NULL
writeAuthorizationRecordId TEXT NOT NULL
activationRecordId TEXT NOT NULL
canonicalReceivableId TEXT NOT NULL
canonicalReceivableFingerprint TEXT NOT NULL
sourceLineageHash TEXT NOT NULL
commandFingerprint TEXT NOT NULL
resultHash TEXT NOT NULL
financialAuditEventId TEXT NOT NULL
correlationId TEXT NOT NULL
schemaVersion INTEGER NOT NULL
createdAt TEXT NOT NULL
```

Operation is exactly `canonical_receivable.initial_post.v1`. Unique keys:
`(companyId, operationType, idempotencyKey)`, `eventId`, `actualSourceKey`, and
`canonicalReceivableId`. Composite FKs connect event, authority, authorization,
activation, canonical receivable and financial audit.

### `canonical_receivable_posting_conflicts`

Columns:

```text
id TEXT PRIMARY KEY
companyId TEXT NOT NULL
branchId TEXT NOT NULL
conflictType TEXT NOT NULL
severity TEXT NOT NULL
eventId TEXT NULL
eventHash TEXT NULL
actualSourceKey TEXT NOT NULL
existingReceivableId TEXT NULL
existingOperationId TEXT NULL
expectedFingerprint TEXT NOT NULL
observedFingerprint TEXT NOT NULL
postingAuthorityRecordId TEXT NOT NULL
writeAuthorizationRecordId TEXT NOT NULL
activationRecordId TEXT NOT NULL
sourceLineageHash TEXT NOT NULL
correlationId TEXT NOT NULL
detectorVersion TEXT NOT NULL
conflictHash TEXT NOT NULL
schemaVersion INTEGER NOT NULL
detectedAt TEXT NOT NULL
createdAt TEXT NOT NULL
```

Conflict type is one of `identity_content_mismatch`, `source_drift`,
`authority_drift`, `authorization_drift`, `activation_drift`, `amount_mismatch`,
`due_date_mismatch`, `duplicate_coverage`, `schema_drift` or
`persisted_result_mismatch` or `post_posting_source_change`; severity is always
`p0`. Unique key is
`(companyId, conflictHash)`.

### Exact domains, checks and foreign-key graph

Every PR9 row has `schemaVersion = 1`; accepting a later integer without a new
migration is forbidden. All IDs, hashes, dates, timestamps, money and JSON use
section 5 limits. Every JSON array is canonical JSON, contains unique strings and
is already sorted by ASCII byte order. Every JSON object is canonical JSON. Every
scope has a concrete company and branch; wildcard-like branch values `*`, `all`,
`global`, `company-wide`, `company_wide`, `any` and `null`, case-insensitive, are
forbidden.

Exact additional domains are:

| Field | Exact v1 domain |
|---|---|
| authority `adapterKind` | `source_adapter`, `eligibility_producer`, `canonical_posting_adapter` |
| authority `status` | `authorized`, `revoked`, `expired`, `superseded` |
| authority `environment` | `production` |
| authority `allowedOperation` | `source_lineage.read.v1` for source adapter; `actual_receivable_eligible.append.v1` for producer; `canonical_receivable.initial_post.v1` for posting adapter |
| authority `credentialType` | only `none_same_process_repository_owned`; fingerprint and issuer are null |
| authorization/activation `status` | `authorized`, `revoked`, `expired`, `superseded` |
| authorization `eventSchemaVersion` | `ActualReceivableEligibleV1` |
| authorization/operation `operationType` | `canonical_receivable.initial_post.v1` |
| authorization `allowedTablesJson` | exactly sorted `canonical_receivable_posting_operations`, `canonical_receivables`, `financial_audit_events` |
| authorization `forbiddenOperationsJson` | exactly sorted `adjust`, `allocate`, `backfill`, `cancel`, `correct`, `delete`, `dual_write`, `refund`, `settle`, `update`, `write_off` |
| activation source systems | exactly `rentcore.billing_source_authority.v1` |
| activation document/rental/currency | `rental_service_upd`, `equipment_rental_line`, `RUB` |
| event `eventSchemaVersion` | `ActualReceivableEligibleV1` |
| event `amountBasis` | `gross` |
| event `dueDateProvenance` | `invoice_due_date`, `contractual_payment_due_date`, `installment_due_date`, `unknown` |
| conflict `severity` | `p0` |
| conflict `detectorVersion` | `canonical-posting-conflict-detector-v1` |

For authority, authorization and activation chains, version is a positive integer,
version 1 has no predecessor, and version N+1 names the exact latest N record of the
same logical ID and scope. `effectiveFrom < expiresAt`; the interval is at most 24
hours. `authorized` has no revocation reason; every terminal state has a non-empty
reason code and cannot return to authorized in the same version. Record/hash and
logical-ID/version keys are unique. Approval refs/hashes, owner refs and all required
policy hashes are non-empty and 64 hex characters where hash-typed.

For event rows: `eventVersion = 1`; `currency = RUB`; all three monetary values are
safe non-negative integers; `netAmountMinor + vatAmountMinor = grossAmountMinor`;
`originalAmountMinor = grossAmountMinor > 0`; dates form a non-empty half-open
interval. `unknown` requires null date and evidence ref; all other provenance
values require a valid date and non-empty evidence ref. PR8 candidate flags remain
exactly `diagnosticOnly = 1`, `canonicalWriteAuthorized = 0` and
`productionActivationAuthorized = 0`; no PR9 constraint reinterprets them.

For operation rows, all fields are non-null, all identities/hashes revalidate, and
the exact event, source key and canonical receivable each seal at most one operation.
For conflict rows, nullable references are permitted only when the referenced row
does not exist; otherwise scope and identity must match. Expected and observed
fingerprints must differ. All source, policy, lineage, command, result, record,
approval, cohort, boundary and evidence hashes are lowercase 64-hex values.

The exact foreign keys all use `ON UPDATE RESTRICT ON DELETE RESTRICT`:

| Child | Child columns → exact parent columns |
|---|---|
| every PR9 table | `companyId` → `canonical_companies(id)`; `(companyId, branchId)` → `canonical_branches(companyId, id)` |
| governed authority | `previousRecordId` → `governed_adapter_authority_records(recordId)` |
| write authorization | `previousRecordId` → same table `recordId`; `(activationBoundaryId, companyId, branchId)` → `billing_source_activation_boundaries(id, companyId, branchId)`; producer/posting authority record IDs → governed authority `recordId` |
| posting activation | `previousRecordId` → same table `recordId`; `(activationBoundaryId, companyId, branchId)` → `billing_source_activation_boundaries(id, companyId, branchId)`; `writeAuthorizationRecordId` → write authorization `recordId` |
| eligible event PR8 | `(dryRunId, companyId, branchId)` → `actual_source_dry_runs(id, companyId, branchId)`; `(candidateId, dryRunId, companyId, branchId)` → `actual_source_dry_run_candidates(id, runId, companyId, branchId)` |
| eligible event PR6 | each of `activationBoundaryId`, `rentalLineId`, `periodId`, `closedPeriodVersionId`, `snapshotId`, `updId`, `formedUpdVersionId`, `conductedUpdVersionId`, `updLineId`, `updLineVersionId`, `coverageSetId`, `coverageSliceId` with `(companyId, branchId)` → the same-ID scoped key of the corresponding `billing_source_*` table |
| eligible event PR9 | `activationRecordId` → posting activation `recordId`; `producerAuthorityRecordId` → governed authority `recordId`; `writeAuthorizationRecordId` → write authorization `recordId` |
| posting operation | `eventId` → eligible event `id`; `postingAuthorityRecordId` → governed authority `recordId`; `writeAuthorizationRecordId` → write authorization `recordId`; `activationRecordId` → posting activation `recordId`; `(companyId, canonicalReceivableId, branchId)` → `canonical_receivables(companyId, id, branchId)`; `financialAuditEventId` → `financial_audit_events(id)` deferred until commit |
| posting conflict | nullable `eventId` → eligible event `id`; nullable `existingOperationId` → posting operation `id`; nullable `(companyId, existingReceivableId, branchId)` → `canonical_receivables(companyId, id, branchId)`; authority/authorization/activation IDs → their exact PR9 record IDs |

Single-column PR9 record references are additionally guarded by before-insert
triggers that require exact company, branch, logical kind/status and current version;
an ID existing in another scope is never sufficient. The PR8 and PR6 composite FKs
are ordered exactly as shown. No JSON reference substitutes for a relational FK.

### Indexes

Exact additional index definitions:

| Name | Unique | Ordered columns |
|---|---|---|
| `uq_pr9_adapter_authority_version` | yes | `authorityId, authorityVersion` |
| `uq_pr9_adapter_authority_hash` | yes | `recordHash` |
| `idx_pr9_adapter_authority_scope` | no | `companyId, branchId, adapterKind, status, expiresAt` |
| `uq_pr9_write_authorization_version` | yes | `authorizationId, authorizationVersion` |
| `uq_pr9_write_authorization_hash` | yes | `recordHash` |
| `idx_pr9_write_authorization_scope` | no | `companyId, branchId, status, expiresAt` |
| `uq_pr9_activation_version` | yes | `activationId, activationVersion` |
| `uq_pr9_activation_hash` | yes | `recordHash` |
| `idx_pr9_activation_scope` | no | `companyId, branchId, status, expiresAt` |
| `uq_pr9_eligible_actual_source` | yes | `companyId, actualSourceKey` |
| `uq_pr9_eligible_event_hash` | yes | `companyId, eventHash` |
| `uq_pr9_eligible_candidate` | yes | `dryRunId, candidateId` |
| `idx_pr9_eligible_scope` | no | `companyId, branchId, createdAt` |
| `uq_pr9_posting_operation_idempotency` | yes | `companyId, operationType, idempotencyKey` |
| `uq_pr9_posting_operation_event` | yes | `eventId` |
| `uq_pr9_posting_operation_source` | yes | `companyId, actualSourceKey` |
| `uq_pr9_posting_operation_receivable` | yes | `canonicalReceivableId` |
| `idx_pr9_posting_operation_scope` | no | `companyId, branchId, createdAt` |
| `uq_pr9_posting_conflict_hash` | yes | `companyId, conflictHash` |
| `idx_pr9_posting_conflict_scope` | no | `companyId, branchId, detectedAt` |

### Triggers

The exact table-local trigger names are:

```text
trg_governed_adapter_authority_records_no_update
trg_governed_adapter_authority_records_no_delete
trg_governed_adapter_authority_records_no_replace
trg_canonical_write_authorization_records_no_update
trg_canonical_write_authorization_records_no_delete
trg_canonical_write_authorization_records_no_replace
trg_canonical_posting_activation_records_no_update
trg_canonical_posting_activation_records_no_delete
trg_canonical_posting_activation_records_no_replace
trg_actual_receivable_eligible_events_no_update
trg_actual_receivable_eligible_events_no_delete
trg_actual_receivable_eligible_events_no_replace
trg_canonical_receivable_posting_operations_no_update
trg_canonical_receivable_posting_operations_no_delete
trg_canonical_receivable_posting_operations_no_replace
trg_canonical_receivable_posting_conflicts_no_update
trg_canonical_receivable_posting_conflicts_no_delete
trg_canonical_receivable_posting_conflicts_no_replace
```

The exact cross-object trigger names are:

```text
trg_pr9_adapter_authority_version_chain
trg_pr9_write_authorization_version_chain
trg_pr9_activation_version_chain
trg_pr9_event_before_operation_seal
trg_pr9_operation_finalize
trg_pr9_canonical_receivable_no_delete
trg_pr9_canonical_receivable_full_immutability
```

Every table-local trigger aborts rather than ignores the prohibited statement.
`no_replace` rejects an insert whose primary key or business unique key already
exists; repositories must classify replay before insert. The version-chain triggers
require version 1 with no predecessor or exact contiguous version N+1 linked to the
latest N row. The event-before-operation trigger requires the exact event/hash and
current authority chain. The operation-finalize trigger permits the operation row
only when its canonical fingerprint and deferred audit reference match the same
transaction result. The audit FK is `DEFERRABLE INITIALLY DEFERRED`, allowing the
mandated canonical → operation → audit insertion order while still failing before
commit if the audit row is absent or different.

The last two cross-object triggers apply only when
`canonical_receivables.sourceSystem = 'rentcore.billing_source_authority.v1'`.
Every field on those PR9-created rows is immutable and deletion is forbidden.

Registered rerun compares exact columns, ordered composite FKs, checks, unique keys,
index metadata and semantic trigger SQL. Drift fails closed without repair or
timestamp mutation. There is no down migration.

## 15. D-PR9-10 — Event-to-canonical mapping

**Status:** `BLOCKED — PRODUCT/FINANCE/ARCHITECTURE APPROVAL REQUIRED`

Recommended exact mapping:

| Canonical field | Authoritative value | Conflict rule |
|---|---|---|
| `id` | repository UUID prefixed `receivable-` | existing different row blocks |
| `companyId` | event `companyId` | exact scope mismatch blocks |
| `branchId` | event `branchId` | exact concrete branch mismatch blocks |
| `clientId` | event `clientId` from PR6/PR8 | no name fallback |
| `contractId` | event `contractId` | null only when approved source contract allows it |
| `rentalId` | event `rentalId` | required |
| `sourceSystem` | literal `rentcore.billing_source_authority.v1` | any other value blocks replay |
| `sourceDocumentType` | literal `upd_coverage_slice_v1` | immutable |
| `sourceDocumentId` | event `updId` | source version retained outside PR1 row |
| `sourceLineId` | event `coverageSliceId` | exact smallest economic slice |
| source document version | event `conductedUpdVersionId` in event/operation/audit | PR1 has no column; mismatch blocks |
| rental line | event `rentalLineId` in event/operation/audit | PR1 has no column; mismatch blocks |
| `externalId` | event `actualSourceKey` | unique within company |
| actual source key | event `actualSourceKey`; mapped to `externalId` | changed content is P0 conflict |
| `idempotencyKey` | `sha256(canonicalJson({companyId, operationType, eventId, eventHash, authorizationId, authorizationVersion}))` | exact replay only |
| `currency` | `RUB` | other currency blocks |
| `originalAmountMinor` | event `grossAmountMinor` | must equal approved event basis |
| `issuedAt` | current conducted UPD version `createdAt` | source drift blocks |
| `postedAt` | repository transaction timestamp | generated once |
| `contractualDueDate` | event date or null for approved unknown | difference blocks |
| `dueDateProvenance` | event provenance | difference blocks |
| `companyTimezone` | fresh active PR5 company timezone | drift from event blocks |
| `workflowStatus` | literal `posted` | draft forbidden |
| `description` | literal `Governed UPD coverage slice` | no customer data |
| `createdAt`, `updatedAt` | same repository transaction timestamp | immutable |
| `version` | `1` | immutable |
| correlation ID | event/operation/audit only | PR1 row has no column |

`cancellationReason`, `cancelledAt`, `closedAt` and `writtenOffAt` are null. A
conflict under any mapped field creates no second receivable and no update.

## 16. D-PR9-11 — Canonical immutability

**Status:** `BLOCKED — FINANCE/LEGAL/ARCHITECTURE APPROVAL REQUIRED`

**Recommended decision:** add source-scoped PR9 triggers. Every PR9-created canonical
row is fully immutable and cannot be deleted. The existing PR1/PR2 behavior for any
non-PR9 source row is unchanged. PR9 does not use the generic mutable audit or
settlement repositories.

Dispute, due-date correction, cancellation, write-off and compensation for a PR9
row require a later append-only design that does not rewrite the original source,
amount or posting evidence. If a future workflow needs a derived state, it must use
new append-only records/projections and a separately reviewed migration rather than
weakening these triggers.

Old PR3 runtime does not write canonical rows, ignores the extra PR9 tables/triggers
and remains application-rollback compatible.

## 17. D-PR9-12 — Conflict and quarantine evidence

**Status:** `BLOCKED — SECURITY/LEGAL/OPERATIONS APPROVAL REQUIRED`

**Recommended decision:** the primary posting transaction rolls back completely on
conflict: canonical, operation and financial-audit writes are all zero. After that
rollback, a separate repository-owned `BEGIN IMMEDIATE` may append exactly one
deduplicated `CanonicalPostingConflictV1` row. Failure to persist conflict evidence
never permits posting; it raises a P0 telemetry failure and opens the circuit.

Conflict evidence contains stable IDs and hashes only, no names, contact data,
amount payload JSON, credentials or free-form source content. Required numeric
amounts are represented only through expected/observed fingerprints. It is retained
indefinitely, is legal-hold eligible, append-only and hash-deduplicated. Exact replay
creates no conflict; same `conflictHash` returns the prior conflict identity.

Financial audit records successful canonical effects. Conflict records prove denied
attempts and are not financial effects.

## 18. D-PR9-13 — Source change after posting

**Status:** `BLOCKED — FINANCE/LEGAL/SOURCE-OWNER APPROVAL REQUIRED`

PR9 performs no background monitoring. On a later attempt/replay, it detects current
PR6 reopen, cancellation, correction, supersession, amount/due-date change, missing
source row, source hash drift or authority revocation. It blocks new posting, writes
no canonical effect and records the approved conflict evidence.

If the canonical row already exists, PR9 never updates or deletes it. The condition
is a P0 `post_posting_source_change` incident for reconciliation and a future
correction/compensation PR. PR9 may expose only the immutable conflict and existing
operation identities to that future workflow. Authority revocation stops future
attempts but does not invalidate or erase prior committed evidence.

## 19. D-PR9-14 — Operational thresholds

**Status:** `BLOCKED — OPERATIONS/SECURITY/PRODUCT APPROVAL REQUIRED`

Recommended v1 numbers:

| Control | Exact limit |
|---|---:|
| admission | 30 posting attempts per company/branch per rolling minute |
| accepted events per PR8 run | 100 |
| writes per posting transaction | 1 receivable |
| active posting concurrency | 1 per company/branch; SQLite still serializes global writers |
| SQLite `busy_timeout` | 5,000 ms |
| automatic repository retry | 0; caller may resubmit the same idempotency key explicitly |
| inert input bytes | 262,144 |
| inert depth | 24 |
| inert nodes | 10,000 |
| event freshness | 15 minutes from PR8 `finalizedAt` to event-production start |
| authority/authorization/activation max lifetime | 24 hours |
| free-space stop | below max of 512 MiB or 20% of mounted volume |
| DB+WAL daily-growth stop | 64 MiB per UTC day |
| conflict circuit breaker | any money/duplicate/source/schema mismatch, or 5 other conflicts in 5 minutes per company/branch |
| audit/conflict persistence failure | immediate circuit open |
| blocker-rate alert | at least 1 blocked posting in 5 minutes |
| latency warning | transaction over 2 seconds |
| latency stop | transaction over 5 seconds |

The future isolated foundation contains validation constants and tests only. No
runtime admission controller, scheduler or production metric wiring belongs to PR9.
Activation remains blocked until an operations layer enforces and observes these
exact limits.

## 20. D-PR9-15 — Retention, legal and incident controls

**Status:** `BLOCKED — LEGAL/SECURITY/OPERATIONS APPROVAL REQUIRED`

Recommended v1 controls:

- authority, authorization, activation, eligible event, posting operation,
  conflict, canonical and financial-audit records are retained indefinitely;
- update, delete, purge, TTL, cleanup and rollback deletion are forbidden;
- legal hold is an append-only hold reference included in exports and blocks any
  future disposal policy;
- privacy class is `confidential_financial_metadata`; stable IDs, amounts and hashes
  are allowed, while names, addresses, contacts, messages and credentials are not;
- export format is canonical UTF-8 JSON Lines plus sorted manifest and SHA-256 for
  every file and the complete export;
- tamper evidence consists of immutable SQLite triggers, complete relational FKs,
  record hashes, operation sealing, backup checksums and independent export verify;
- backup scope is the coherent entire SQLite database, manifest and application
  artifact identity before first activation and after every schema change;
- target RPO is 15 minutes; target RTO is 60 minutes;
- posting incident response immediately opens the kill switch, appends authority
  revocation, preserves DB/WAL/evidence, captures coherent encrypted backup, runs
  integrity/FK/reconciliation queries and forbids deletion/repair-in-place;
- credential incident response revokes first, verifies rejection using safe
  fingerprint only, leaves no active consumer, and requires new authorization;
- audit owner is the named finance authority; custody owner is the named database
  backup owner; security owner controls adapter identity/revocation; operations owns
  telemetry and incident execution.

No named owner acceptance of these proposed targets is present.

## 21. D-PR9-16 — PR structure

**Status:** `BLOCKED — ARCHITECTURE/SECURITY/RELEASE APPROVAL REQUIRED`

**Recommended decision:** stacked PR9a/PR9b under this single architecture gate.

### PR9a — Authority, schema and eligibility-event foundation

Allowed production files:

```text
server/db.js
server/lib/canonical-actual-posting-schema.js
server/lib/canonical-actual-posting-domain.js
server/lib/canonical-actual-posting-authority-repository.js
server/lib/canonical-actual-eligibility-event-repository.js
server/lib/canonical-actual-eligibility-event-service.js
```

Allowed tests/docs:

```text
tests/canonical-actual-posting-fixtures.js
tests/canonical-actual-posting-schema.test.js
tests/canonical-actual-posting-domain.test.js
tests/canonical-actual-posting-authority.test.js
tests/canonical-actual-eligibility-event.test.js
tests/canonical-actual-posting-structural.test.js
tests/canonical-actual-posting-safety.test.js
tests/helpers/canonical-actual-eligibility-concurrency-worker.mjs
docs/canonical-actual-posting-pr9a-audit.md
docs/canonical-receivables-contract.md
docs/canonical-receivables-decisions.md
```

PR9a applies `canonical_actual_posting_pr9` v1 and implements no canonical DML.
Production reaches only the schema initializer.

### PR9b — Isolated posting repository/service

Allowed production files:

```text
server/lib/canonical-actual-posting-domain.js
server/lib/canonical-actual-posting-repository.js
server/lib/canonical-actual-posting-service.js
```

Allowed tests/docs:

```text
tests/canonical-actual-posting-fixtures.js
tests/canonical-actual-posting-repository.test.js
tests/canonical-actual-posting-concurrency.test.js
tests/canonical-actual-posting-remediation.test.js
tests/canonical-actual-posting-safety.test.js
tests/helpers/canonical-actual-posting-concurrency-worker.mjs
docs/canonical-actual-posting-pr9b-audit.md
docs/canonical-receivables-contract.md
docs/canonical-receivables-decisions.md
```

PR9b adds no migration and remains unreachable from production. It may write only
through isolated tests. A single large PR9 is rejected by recommendation because it
would combine a new authority model, six-table migration, event producer and the
first canonical DML boundary into one security review.

Neither PR is authorized by this document. PR9b additionally requires independently
released PR9a and its own exact implementation authorization.

## 22. Exact contract envelopes

### `GovernedAdapterAuthorityV1`

Required fields are every column in `governed_adapter_authority_records`; only
`previousRecordId`, `credentialFingerprint`, `credentialIssuerRef` and
`revocationReasonCode` are nullable under their enum rules. Identity is
`authorityId + authorityVersion`. Hash envelope includes every field except
`recordId`, `recordHash` and `createdAt`. Latest version is the highest contiguous
version whose previous-record chain matches. Exact same identity/content replays;
changed content at an existing version conflicts. Revoked/expired is terminal for
that version and blocks immediately.

### `ActualReceivableEligibleV1`

Required fields are every event column except `contractId`,
`contractualDueDate`, and `dueDateEvidenceRef` under the approved due-date rules.
Identity is:

```text
actualSourceKey = sha256(canonicalJson({
  companyId, branchId, activationBoundaryId, cohortHash,
  periodId, closedPeriodVersionId, snapshotId,
  updId, conductedUpdVersionId, updLineId, updLineVersionId,
  coverageSetId, coverageSliceId,
  dueDateProvenance, contractualDueDate, dueDateEvidenceRef,
  amountBasisPolicyHash
}))
```

`eventHash` covers every business field except generated `id`, `eventHash`,
`occurredAt` and `createdAt`. Event version is exactly 1. Same actualSourceKey and
same eventHash replay; same actualSourceKey with a different hash conflicts.

### `CanonicalWriteAuthorizationV1`

Required fields are every authorization column except `previousRecordId` and
`revocationReasonCode`. Identity is `authorizationId + authorizationVersion`.
Hash envelope excludes only generated `recordId`, `recordHash` and `createdAt`.
Approval set must contain stable refs and hashes for product, accountant/finance,
legal, tax, security/identity, release/operations, source-adapter owner,
producer owner, posting-adapter owner and independent reconciliation reviewer.
Expiry or revocation blocks even exact replay.

### `CanonicalPostingActivationV1`

Required fields are every activation column except `previousRecordId` and
`revocationReasonCode`. Identity is `activationId + activationVersion`; hash envelope
excludes generated record ID/hash/timestamp. It is default-denied when missing,
ambiguous, not-yet-effective, expired, revoked, superseded or mismatched. Deployment
does not create or select it.

### `CanonicalPostingOperationV1`

Every operation column is required. Identity is company + operation type +
idempotency key. `commandFingerprint` covers selectors/assertions supplied before
the lock. `canonicalReceivableFingerprint` covers the exact persisted PR1 row.
`resultHash` covers event, authority, authorization, activation, source lineage,
canonical fingerprint, audit ID and correlation. Operation insert seals the result;
late mutation is impossible.

### `CanonicalPostingConflictV1`

Every conflict column is required except event/existing-row references when the
corresponding record does not exist. Identity is company + `conflictHash`.
`conflictHash` covers type, scope, actual source, expected/observed fingerprints,
authority/authorization/activation records, source lineage and detector version.
Exact replay returns the existing conflict; a changed observation is a new immutable
conflict.

### Repository-derived financial audit event

The existing `financial_audit_events` row is constructed only by the PR9 repository:

```text
aggregateType = canonical_receivable
aggregateId = canonicalReceivableId
eventType = canonical_receivable.initial_posted.v1
actorType = integration
actorId = integration:rentcore-canonical-receivable-posting
occurredAt = posting transaction timestamp
reason = NULL
previousValueJson = NULL
newValueJson = canonical JSON containing only receivable fingerprint,
  event ID/hash, actualSourceKey, authority/authorization/activation record IDs,
  sourceLineageHash and operation ID
correlationId = event correlationId
sourceSystem = rentcore.billing_source_authority.v1
createdAt = posting transaction timestamp
```

Caller actor/audit JSON is never accepted. Audit insert failure rolls back the
receivable and operation.

## 23. Exact transaction algorithm

Before `BEGIN IMMEDIATE`, only deeply inert selector/assertion materialization,
bounded validation and repository-owned immutable planning are allowed. No final
security, source, policy, replay or write decision is made. No caller callback,
clock, ID generator, hook or policy function can cross the lock boundary.

Inside one repository-owned `BEGIN IMMEDIATE`:

1. reread the eligibility event by exact ID/company/branch;
2. reread and structurally verify the PR8 run, candidate, operation, audit and seal;
3. reread the complete current PR6 16-table universe for the exact lineage;
4. reread latest producer and posting adapter authority chains;
5. validate credential type, artifact/config/policy identity, effective time,
   expiry, revocation and supersession;
6. reread latest write authorization chain;
7. reread latest activation chain and exact boundary/cohort;
8. verify amount, due-date, evidence, source-ownership and policy hashes;
9. detect reopen/cancel/correct/supersession, source drift, overlap and duplicate
   economic coverage;
10. look up existing event/source/idempotency/canonical operation and classify exact
    replay versus conflict;
11. for a new write, generate repository UUIDs and one transaction timestamp and
    construct every row/hash internally;
12. insert one direct-`posted` canonical receivable;
13. insert one posting operation seal with its pre-generated deferred audit ID;
14. insert one repository-derived financial audit row;
15. reread all three relational rows and referenced event/authority records;
16. reconstruct exact canonical, audit, operation and result hashes/counts/links;
17. commit only on exact equality.

Exact replay under still-current authority returns the original logical result with
`replayed = true` and writes nothing. Changed-content replay rolls back all primary
writes, then may append one deduplicated conflict in the separate transaction from
section 17. Expired/revoked/drifted authority blocks even identical payload.

`SQLITE_BUSY` and `SQLITE_LOCKED` become
`CANONICAL_POSTING_CONCURRENT_CONFLICT`; repository retry count is zero. Insert,
audit, operation, trigger or reread mismatch rolls back the primary transaction.
Concurrent processes yield one committed winner and exact replay or deterministic
conflict, never partial rows or raw SQLite lock errors.

## 24. Migration and runtime compatibility proof obligations

Future implementation must prove:

- PR1–PR8 migration source remains unchanged;
- current seven-row post-rollback baseline is accepted as the input state;
- first apply uses a single immediate transaction and registration-last behavior;
- valid registered rerun is read-only and preserves `applied_at`;
- registered drift is rejected without repair;
- partial/unregistered state is rejected and not normalized;
- zero-row prerequisites apply only to first application;
- after successful posting, repeated startup permits business rows and verifies
  structure without writing;
- old PR3 application starts against additive PR9 objects, ignores them and retains
  all tables/triggers/registration;
- old PR3 does not create a second company/branch authority or execute PR9;
- rollback is application-only; no down migration, deletion or restoration over
  committed financial facts is allowed.

The only production-reachable future diff is an import/call of the PR9 schema
initializer in `server/db.js` after `ensureActualSourceEligibilityDryRunSchema(db)`.
`server/server.js`, routes, flags, resolvers, workers, queues, schedulers, timers,
CLI, frontend and startup business execution remain unchanged.

## 25. Future test matrix and acceptance criteria

### Schema

- exact first migration on fresh chain and current seven-row production-shaped
  local fixture;
- exact six tables, columns, PKs, ordered composite FKs, checks, indexes and triggers;
- forced failure at every DDL/registration stage leaves zero PR9 objects/row;
- partial, competing, wrong-version and registered-weakened schemas fail closed;
- repeated valid startup preserves every migration timestamp and creates no WAL;
- non-empty post-posting registered rerun succeeds read-only;
- FK/integrity checks pass; old PR3 runtime compatibility passes.

### Domain/input

- exact enums, IDs, dates, timestamps, RUB integer limits and net+VAT=gross;
- proxy/accessor/custom prototype/toJSON/function/symbol/cycle/sparse array,
  hidden field, secret-like key, float/unsafe integer and byte/depth/node rejection;
- no getter or callback executes; canonical JSON/hash fixtures are stable;
- gross basis and due-date rules match the approved policy exactly.

### Authority and activation

- contiguous immutable version chains; missing/duplicate/ambiguous versions deny;
- expired/revoked/superseded/not-yet-effective states deny;
- human/admin/system impersonation denies;
- artifact, commit, config, policy, environment, scope, operation and cohort drift
  deny after lock;
- catalog remains exact v1/11 and PR5–PR8 assertions continue passing.

### Eligibility event

- only an accepted, sealed, current, blocker-free PR8 candidate can emit;
- fixture/unaccepted/stale/unsealed/blocked candidate denies;
- every PR6 row/version/hash and zero-delta reconciliation is current;
- PR7/app_data fallback is structurally absent;
- exact replay creates no second event; changed source/policy/due/amount conflicts;
- event production performs no canonical/settlement/legacy write.

### Posting

- event-to-PR1 mapping is exact; workflow is direct `posted` only;
- repository owns actor, row, timestamps, IDs, hashes and audit;
- source reopen/cancel/correct/supersession and overlapping coverage deny;
- exact replay writes nothing; changed replay writes zero canonical rows and records
  only the approved conflict evidence;
- revocation/expiry between planning and lock denies;
- forced failure at receivable, audit, operation and reread stages rolls back all;
- persisted-row mutation/ignore/extra-row fault injection is detected;
- full PR9 canonical immutability and no-delete triggers are enforced.

### Concurrency and operations

- independent processes produce one winner plus exact replay/conflict;
- no raw busy/locked errors, duplicates, orphan operations or missing audit;
- limit boundary tests cover 30/minute, 100/run, 262144 bytes, depth 24, 10000 nodes,
  15-minute freshness, five-second timeout and storage/circuit thresholds.

### Static isolation and conservation

- server dependency graph reaches only PR9 schema;
- no route/API/flag/resolver/worker/CLI/frontend/package change;
- no PR6/PR7/PR8/settlement/app_data/legacy DML;
- no forecast read, backfill, historical import, dual write or source-label matching;
- canonical/forecast resolvers remain null and flags default false;
- startup creates zero PR9 business/canonical/settlement rows;
- repository and diff secret scans are clean.

### Required implementation checks

```text
git diff --check
focused PR9 suites twice
PR1–PR8 compatibility suites
npm test
node --test tests/*.test.js
npm run build
foreign_keys = 1
foreign_key_check = 0 rows
integrity_check = ok
```

Passing tests authorizes no merge, deployment, activation, reads or writes.

## 26. Authorization matrix

| Field | Current value | Reason |
|---|---|---|
| `architectureDesignApproved` | `FALSE` | blocked: exact proposal recorded; no durable owner approval |
| `productionEvidenceAccepted` | `FALSE` | blocked: no accepted current PR8 production evidence pack |
| `productionIdentityReady` | `FALSE` | blocked: PR5 business/bootstrap rows remain zero |
| `productionSourceAuthorityReady` | `FALSE` | blocked: PR6 business rows and approved adapter instance absent |
| `productionDryRunExecutionAuthorized` | `FALSE` | no separate execution authorization |
| `productionDryRunExecutionCompleted` | `FALSE` | PR8 production rows remain zero |
| `productionDryRunEvidenceAccepted` | `FALSE` | blocked: no production run/evidence acceptance |
| `sourceAdapterAuthorityApproved` | `FALSE` | blocked: design only; no concrete production authority |
| `eligibilityProducerAuthorityApproved` | `FALSE` | blocked: design identity only |
| `canonicalPostingAdapterAuthorityApproved` | `FALSE` | blocked: design identity only |
| `operationalControlsApproved` | `FALSE` | blocked: exact proposed numbers lack owner approval/enforcement |
| `retentionAndLegalHoldControlsApproved` | `FALSE` | blocked: proposed controls lack legal/operations approval |
| `canonicalWriteContractApproved` | `FALSE` | blocked: D-PR9-01–16 are not owner-approved |
| `pr9ImplementationAuthorized` | `FALSE` | explicit current gate |
| `pr9DisabledDeploymentAuthorized` | `FALSE` | separate decision absent |
| `productionActivationAuthorized` | `FALSE` | separate decision absent |
| `canonicalProductionReadsAuthorized` | `FALSE` | resolver null; flag default false; no approval |
| `productionCanonicalWritesAuthorized` | `FALSE` | no authorization/activation/evidence |
| `settlementAuthorized` | `FALSE` | PR10 not authorized |
| `shadowReadAuthorized` | `FALSE` | PR11 not authorized |
| `cutoverAuthorized` | `FALSE` | PR12 not authorized |

## 27. D-PR9 status matrix

| Decision | Status | Recommended selection awaiting approval |
|---|---|---|
| D-PR9-01 Amount basis | `BLOCKED` | gross RUB minor units; no recalculation |
| D-PR9-02 Due date | `BLOCKED` | approved unknown may post outside aging; proven allow-list otherwise |
| D-PR9-03 Conducted/signature/evidence | `BLOCKED` | latest current conducted plus exact policy/evidence lineage |
| D-PR9-04 Source systems/adapters | `BLOCKED` | canonical source `rentcore.billing_source_authority.v1`; exact upstream allow-list per authority |
| D-PR9-05 Integration identity | `BLOCKED` | named same-process repository identities; 24-hour authority, no credential |
| D-PR9-06 Capability catalog | `BLOCKED` | strategy A; keep exact human catalog v1/11 |
| D-PR9-07 Boundary/cohort | `BLOCKED` | one company/branch, RUB, forward-only governed rental UPD slice |
| D-PR9-08 PR8 evidence | `BLOCKED` | sealed accepted production run; zero blockers/deltas; 15-minute freshness |
| D-PR9-09 DB objects | `BLOCKED` | migration v1, exact six-table set and source-scoped canonical triggers |
| D-PR9-10 Mapping | `BLOCKED` | UPD + coverage slice, actualSourceKey external ID, gross, direct posted |
| D-PR9-11 Immutability | `BLOCKED` | full no-update/no-delete for PR9-source canonical rows |
| D-PR9-12 Conflict evidence | `BLOCKED` | zero primary writes; separate deduplicated append-only conflict transaction |
| D-PR9-13 Post-posting changes | `BLOCKED` | detect/deny/quarantine; future compensation only |
| D-PR9-14 Thresholds | `BLOCKED` | exact limits in section 19 |
| D-PR9-15 Retention/incidents | `BLOCKED` | indefinite, confidential metadata, RPO 15m/RTO 60m |
| D-PR9-16 PR structure | `BLOCKED` | stacked PR9a schema/event then PR9b posting |

No D-PR9 decision is approved by this document.

## 28. Owner Decision Packet

The owner may approve the complete recommendation in one later message only after
the named finance, legal, tax, security and operations authorities have approved
the decisions assigned to their roles. No secret or production access is needed.
Each required authority must submit the applicable exact line below through an
authenticated, durable review channel. The channel's immutable author identity,
UTC creation timestamp and permanent message URL are respectively the approver,
approval timestamp and approval reference; the system must preserve those metadata
with the literal approval text. A role-to-person registry must independently prove
that the authenticated author held the named role at that time. One person's
approval cannot stand in for a second required role.

| Decision and question | Recommended option | Alternatives and consequence | Principal risk | Exact approval line |
|---|---|---|---|---|
| D-PR9-01: amount basis? | exact gross RUB kopecks; no recalculation | net understates debt; another basis requires a new mapping | wrong customer obligation | `APPROVE D-PR9-01 v1 exactly as recommended in section 6 of PRE-PR9 Design Closure audited at base 9870c279166e41dc0a059763240a8ce892abf54d.` |
| D-PR9-02: may unknown due date post? | yes only as null and outside aging under `post_without_aging_v1` | proven-only delays receivable; broader inference creates false aging | false aging or blocked debt | `APPROVE D-PR9-02 v1 exactly as recommended in section 7 of PRE-PR9 Design Closure audited at base 9870c279166e41dc0a059763240a8ce892abf54d.` |
| D-PR9-03: what proves conducted/signature state? | exact current closed/conducted/coverage/evidence chain | always-signed is stricter; label inference is forbidden | fabricated debt | `APPROVE D-PR9-03 v1 exactly as recommended in section 8 of PRE-PR9 Design Closure audited at base 9870c279166e41dc0a059763240a8ce892abf54d.` |
| D-PR9-04: which source/adapters? | PR6 logical source plus concrete authority allow-list | direct mutable upstream IDs weaken stable lineage | fallback or wrong source | `APPROVE D-PR9-04 v1 exactly as recommended in section 9 of PRE-PR9 Design Closure audited at base 9870c279166e41dc0a059763240a8ce892abf54d.` |
| D-PR9-05: which integration identity? | named same-process identities, no credential, 24-hour authority | external workload credential requires a new security design | impersonation | `APPROVE D-PR9-05 v1 exactly as recommended in section 10 of PRE-PR9 Design Closure audited at base 9870c279166e41dc0a059763240a8ce892abf54d.` |
| D-PR9-06: how to coexist with catalog v1/11? | strategy A; separate integration contracts | catalog migration broadens scope and can break PR5–PR8 checks | authorization regression | `APPROVE D-PR9-06 v1 strategy A exactly as recommended in section 11 of PRE-PR9 Design Closure audited at base 9870c279166e41dc0a059763240a8ce892abf54d.` |
| D-PR9-07: what activation cohort? | one company/branch, RUB, forward-only governed rental-UPD slice | broader or historical cohort increases duplicate/cross-scope exposure | unintended posting scope | `APPROVE D-PR9-07 v1 exactly as recommended in section 12 of PRE-PR9 Design Closure audited at base 9870c279166e41dc0a059763240a8ce892abf54d; no production activation is authorized.` |
| D-PR9-08: which PR8 evidence is admissible? | accepted sealed zero-delta run, 15-minute freshness | longer/stale or fixture evidence weakens proof | stale or fabricated eligibility | `APPROVE D-PR9-08 v1 exactly as recommended in section 13 of PRE-PR9 Design Closure audited at base 9870c279166e41dc0a059763240a8ce892abf54d.` |
| D-PR9-09: what migration object set? | `canonical_actual_posting_pr9` v1, exact six tables/indexes/triggers | another normalized set changes lineage and rollback proof | schema drift | `APPROVE D-PR9-09 v1 exactly as recommended in section 14 of PRE-PR9 Design Closure audited at base 9870c279166e41dc0a059763240a8ce892abf54d.` |
| D-PR9-10: how does event map to PR1? | exact section-15 projection | PR1 extension broadens migration; coarser source identity permits duplicates | unreproducible debt | `APPROVE D-PR9-10 v1 exactly as recommended in section 15 of PRE-PR9 Design Closure audited at base 9870c279166e41dc0a059763240a8ce892abf54d.` |
| D-PR9-11: may PR9 canonical rows mutate? | database-enforced full no-update/no-delete | PR1 lifecycle updates would rewrite the immutable fact | history mutation | `APPROVE D-PR9-11 v1 exactly as recommended in section 16 of PRE-PR9 Design Closure audited at base 9870c279166e41dc0a059763240a8ce892abf54d.` |
| D-PR9-12: may denied conflict evidence persist? | zero primary writes, then one separate deduplicated conflict row | absolute zero writes loses durable denial evidence | side effect or lost evidence | `APPROVE D-PR9-12 v1 exactly as recommended in section 17 of PRE-PR9 Design Closure audited at base 9870c279166e41dc0a059763240a8ce892abf54d.` |
| D-PR9-13: what follows post-posting source change? | detect, deny, quarantine; later compensation design | mutable correction destroys original history | incorrect correction | `APPROVE D-PR9-13 v1 exactly as recommended in section 18 of PRE-PR9 Design Closure audited at base 9870c279166e41dc0a059763240a8ce892abf54d.` |
| D-PR9-14: which operational limits? | every exact number in section 19 | different values require explicit replacement decision | outage or unbounded writes | `APPROVE D-PR9-14 v1 exactly as recommended in section 19 of PRE-PR9 Design Closure audited at base 9870c279166e41dc0a059763240a8ce892abf54d.` |
| D-PR9-15: which retention/incident controls? | indefinite retention, RPO 15m, RTO 60m and section-20 controls | finite disposal or other targets need legal/operations approval | evidence loss or privacy breach | `APPROVE D-PR9-15 v1 exactly as recommended in section 20 of PRE-PR9 Design Closure audited at base 9870c279166e41dc0a059763240a8ce892abf54d.` |
| D-PR9-16: one PR or stacked? | PR9a schema/event, then PR9b isolated posting | one PR combines security, migration and first-write review | unreviewable boundary | `APPROVE D-PR9-16 v1 exactly as recommended in section 21 of PRE-PR9 Design Closure audited at base 9870c279166e41dc0a059763240a8ce892abf54d.` |

The required approving roles are exactly those named in each decision status and
section. Approval of D-PR9-01–16 would permit setting
`architectureDesignApproved = TRUE` and `canonicalWriteContractApproved = TRUE`
only if every approval text and its identity/timestamp/reference metadata are
durable and independently verifiable. It would still leave:

```text
pr9ImplementationAuthorized = FALSE
pr9DisabledDeploymentAuthorized = FALSE
productionActivationAuthorized = FALSE
canonicalProductionReadsAuthorized = FALSE
productionCanonicalWritesAuthorized = FALSE
```

The owner must issue a later, separate exact implementation authorization before
PR9a, and another before PR9b. Deployment and every production operation remain
outside this packet.

## 29. Explicit non-goals and prohibited actions

This design does not and must not:

- add JavaScript, SQL, schema, migration, fixture or test implementation;
- change `server/db.js`, `server/server.js`, routes, flags, resolvers or frontend;
- access Railway or production data;
- create identities, credentials, authority, authorization or activation records;
- deploy, restart, migrate, bootstrap, populate PR6, calculate PR7 or execute PR8;
- enable canonical/forecast reads or canonical writes;
- implement PR9, PR10, PR11 or PR12;
- backfill, dual-write, shadow-read, settle, correct or cut over;
- infer approval from merge, CI, usernames, prompt text or silence;
- merge its own pull request.

The only permitted outcome is a reviewable docs-only proposal plus an owner decision
packet, with every operational and implementation authorization fail closed.
