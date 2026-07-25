# PRE-PR9 Design Closure: Canonical Actual Posting Foundation v1

## 1. Status and safety boundary

**Document status:** `DESIGN CLOSURE READY FOR RISK-BASED GATE A APPROVAL`

**Design-only audit timestamp:** `2026-07-25T16:35:40Z`

**Repository:** `rishatkznAI/rental-management`

**Audited base:** `9870c279166e41dc0a059763240a8ce892abf54d`

This document is an exact **design recommendation** for PR9. It is not an approval
record and does not implement, authorize, deploy or activate PR9. D-PR9-01–16 are
Gate A design assumptions awaiting durable approval by the Product/Business Owner
after an independent Technical Architecture Reviewer has approved this exact
document head. Gate A closes only the architecture design. It does not certify
accounting, tax, legal/privacy or operational correctness for production and does
not authorize implementation or any production action.

The required authorization state remains:

```text
foundationDeploymentRetryAuthorized = FALSE
architectureDesignApproved = FALSE
pr9aImplementationAuthorized = FALSE
pr9bImplementationAuthorized = FALSE
pr9ImplementationAuthorized = FALSE
pr9DisabledDeploymentAuthorized = FALSE
productionActivationAuthorized = FALSE
canonicalProductionReadsAuthorized = FALSE
productionCanonicalWritesAuthorized = FALSE
settlementAuthorized = FALSE
shadowReadAuthorized = FALSE
cutoverAuthorized = FALSE
```

Merging this design document, passing CI, or receiving no objection changes none of
those values. After Gate A closes, PR9a still requires a later, separately recorded
`pr9aImplementationAuthorized = TRUE` owner decision tied to its exact scope and
base SHA. PR9b requires its own later authorization after Gate C. Disabled
deployment, release, production activation, canonical reads, canonical writes,
settlement, shadow reads and cutover remain separate later decisions. The legacy
aggregate `pr9ImplementationAuthorized` field remains `FALSE` and cannot substitute
for either scoped implementation gate.

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
- retained JSON evidence may contain stable IDs, hashes, exact enum decisions,
  validated non-PII configuration identifiers such as an IANA timezone, and safe
  integer versions/counts only. Names, contacts, addresses, free-form messages,
  credentials, tokens, cookies, sessions and authorization headers are forbidden.

### 5.1 Risk-based staged governance

The governance boundary has four independent gates. Approval at one gate never
implies approval at a later gate.

#### Gate A — Architecture design

Gate A approves the contracts, schema design, transaction design, isolation, test
matrix and PR9a/PR9b split recorded in this document. It requires exactly:

- a Product/Business Owner durable approval; and
- a durable approval from a Technical Architecture Reviewer who is independent of
  the document author for this review.

Automated Codex review may be retained as technical evidence, but it cannot provide
either durable approval. Both approvals must identify PR #231 and the same exact
document head SHA in an authenticated durable channel. Gate A approval does not
assert accounting correctness, tax treatment, legal sufficiency, privacy
compliance, operational readiness or production evidence validity. It authorizes no
implementation, deployment, migration or production read/write.

#### Gate B — Disabled implementation

Gate B may authorize only PR9a: additive schema, immutable contracts, the
eligibility-event foundation, disabled repository/domain code, tests and fixtures.
The schema initializer is in scope only when the Gate B approval says so explicitly.
No production business execution, canonical DML, route, worker, scheduler, flag,
resolver or activation path is allowed.

Gate B requires a separate Product/Business Owner authorization naming the exact
PR9a implementation scope and base SHA. Accounting, Tax/VAT and Legal/Privacy
approval is not a Gate B prerequisite because PR9a must read no production data,
perform no production write, recognize no financial fact and remain unactivated.
Gate A approval alone never opens Gate B.

#### Gate C — Production evidence and policy

Gate C is required before any PR9b production-capable posting implementation or
production dry run. Approvals are role-scoped rather than an enterprise board:

- Accounting/Finance approves amount basis, due-date and source-document semantics;
- Tax/VAT approves VAT, gross/net and rounding policy;
- Legal/Privacy approves evidence sufficiency, retention, privacy and legal hold;
- Security/Operations approves credential and authority design, monitoring,
  rollback and incident controls; and
- an independent production evidence reviewer accepts the exact production
  evidence pack and must not be its sole author or producer.

One qualified person may hold multiple Gate C roles when that reflects the real
organization, the combined roles and potential conflict are durably disclosed, and
each role-scoped approval is explicit. No artificial one-person-per-decision rule
applies. A technical description is not a substitute for accounting, tax, legal or
security approval. Gate C approves only the policy/evidence contracts assigned to
each role; it does not authorize deployment or production canonical writes.

#### Gate D — Production activation and write authorization

Gate D is a separate, single-use authorization immediately before any Railway
mutation, production deployment, production PR8 execution or canonical write
activation. It requires an independently issued release authorization bound to the
exact artifact, environment, database identity, cohort, evidence pack, effective
window and rollback controls. The release authorizer cannot be the sole implementer
or sole producer/reviewer of the evidence being released. Gate D expires after its
named action/window and cannot be inferred from Gates A–C, merge or CI.

Segregation of duties is therefore proportional to risk: role combination is
permitted for a small owner-operated product with durable disclosure, while
independence is mandatory for Gate A technical review, production evidence review
and Gate D release authorization. An author cannot be the only reviewer of their
own production evidence, and automated review never replaces owner authorization.

In sections 6–25, an "approved" policy, authority, evidence pack, activation or
production value means approved at its applicable later Gate C or Gate D. Gate A
approves only the shape and fail-closed behavior of those contracts.

## 6. D-PR9-01 — Amount basis

**Status:** `GATE A DESIGN ASSUMPTION PENDING; GATE C PRODUCTION POLICY
REVALIDATION REQUIRED`

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

**Status:** `GATE A DESIGN ASSUMPTION PENDING; GATE C PRODUCTION POLICY
REVALIDATION REQUIRED`

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
  dueDatePolicyId, dueDatePolicyVersion, dueDatePolicyHash }
```

For `unknown`, the date and evidence ref are null and the explicit unknown-policy
ID/version/hash are required. For proven dates, date and evidence ref are required.
`dueDatePolicyId` is the immutable `decisionRef` from the accepted PR8
`unknown_due_date_treatment` policy-manifest entry, `dueDatePolicyVersion` is its
positive integer `decisionVersion`, and `dueDatePolicyHash` is its exact lowercase
SHA-256 `decisionHash`.
The three values are inseparable: authorization, activation, event production and
posting reread the same canonical persisted PR8 policy manifest under lock and
reject missing, ambiguous or mixed ID/version/hash bindings.
The envelope participates in `eventHash` and posting result hash, but is expressly
excluded from the policy-independent `economicSourceKey`. A due-date or policy
change for the same economic source is therefore a conflict, never a second event.

A different due date/provenance/evidence under the same source slice is a P0
conflict, not a second receivable. A later proven date requires the separately
approved PR2 due-date-change workflow; PR9 never updates it.

## 8. D-PR9-03 — Conducted, signature and evidence authority

**Status:** `GATE A DESIGN ASSUMPTION PENDING; GATE C PRODUCTION POLICY
REVALIDATION REQUIRED`

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

**Status:** `GATE A DESIGN ASSUMPTION PENDING; CONCRETE PRODUCTION AUTHORITY
REMAINS GATE C`

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

Every write authorization, event, posting operation and conflict evidence row binds
the exact `sourceAdapterAuthorityRecordId`, authority version and authority record
hash. That binding is relational, scope-qualified and revalidated against the latest
authority row and the complete PR6 ownership/upstream-row universe while locked; a
caller-provided adapter label or hash is never authority.

No concrete production adapter instance is approved or created by this document.

## 10. D-PR9-05 — Integration identity

**Status:** `GATE A DESIGN ASSUMPTION PENDING; CONCRETE PRODUCTION IDENTITY
REMAINS GATE C`

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

**Status:** `GATE A DESIGN ASSUMPTION PENDING`

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

**Status:** `GATE A DESIGN ASSUMPTION PENDING; GATE C PRODUCTION POLICY
REVALIDATION REQUIRED; ACTIVATION REMAINS GATE D`

**Recommended immutable v1 definition:** one activation record covers exactly one
company, one concrete branch, the source system
`rentcore.billing_source_authority.v1`, currency `RUB`, source class
`conducted_upd_validated_coverage_slice_v1`, and half-open source period with
`sliceStartDate >= forwardOnlyStartDate`. It has no wildcard and no partial-period
trimming.

Allowed document/rental classes are exactly `rental_service_upd` and
`equipment_rental_line`; all sales, service repair, delivery, leasing, payroll,
advance, payment, forecast and historical/imported classes are excluded.

`cohortHash` is exactly `CanonicalPostingCohortHashV1` and `boundaryHash` is exactly
`CanonicalPostingBoundaryHashV1` from section 22.10. Both hash logical normalized
arrays, never stored JSON text. The one concrete branch is represented as a
single-member `branchIds` array; duplicate, empty, wildcard or unsorted members are
rejected. The boundary persists the PR5-timezone-derived
`forwardOnlyStartUtc`, an explicit nullable `boundaryEndUtc`, and the civil
`forwardOnlyStartDate`; lifecycle `effectiveFrom`/`expiresAt` never silently become
source-boundary identity.

The activation has an explicit UTC effective/expiry window not exceeding 24 hours.
Change, renewal, expansion, revocation or supersession appends a new version and
requires a new accepted evidence pack and write authorization. No production value
or activation record is created here.

## 13. D-PR9-08 — Accepted PR8 evidence

**Status:** `GATE A EVIDENCE-CONTRACT DESIGN ASSUMPTION PENDING; ACTUAL PRODUCTION
EVIDENCE ACCEPTANCE REMAINS GATE C`

**Recommended admission contract:** an admissible run must be a real production PR8
run created under an approved policy/source/adapter/activation scope. The one exact
`AcceptedPr8EvidencePredicateV1` is the conjunction of all of these terms:

```text
run.status = completed
run.candidateCount > 0
run.blockedCandidateCount = 0
candidate.status = eligible_candidate
candidate.blockerCount = 0
sealComplete = true
diagnosticOnly = true
canonicalWriteAuthorized = false
productionActivationAuthorized = false
unexplainedNetDeltaMinor = 0
unexplainedVatDeltaMinor = 0
unexplainedGrossDeltaMinor = 0
policyManifestHash = acceptedPolicyManifestHash
sourceOwnershipManifestHash = acceptedSourceOwnershipManifestHash
sourceInputManifestHash = acceptedSourceInputManifestHash
{dryRunId,resultHash} is one exact accepted pair
attemptedAt >= finalizedAt
attemptedAt <= finalizedAt + acceptedEvidenceFreshnessInterval
acceptedEvidenceFreshnessInterval = 15 minutes
```

`sealComplete` is repository-derived and true only when the complete run operation,
audit, input, candidate, check, reconciliation and diagnostic row graph exists and
all counts, relational links and hashes reproduce byte-exactly. The three unexplained
deltas are derived from every relevant persisted reconciliation, not caller totals.
The accepted policy, ownership and source-input hashes and the exact
`{dryRunId,resultHash}` pair come from the independently signed acceptance record.
No post-result manual exclusion or aggregate netting is allowed. The evidence pack
also names environment, deployment/artifact, DB identity, capture time, tool/query
class, reviewer and exact SHA-256 pack hash.

Fixtures, tests, local SQLite, manually built JSON and this document are never
production evidence. In particular, `diagnosticOnly = true` is required and does not
become false; both write flags are required to remain false. Acceptance authorizes
only event eligibility under its exact scope; it does not reinterpret PR8 as a write
authorization and does not authorize canonical posting.

Accepted evidence is represented only as the ordered set
`acceptedDryRuns=[{dryRunId,resultHash}]`. It is sorted lexicographically by
`dryRunId`, rejects duplicate IDs (therefore also duplicate pairs), requires one
exact result hash per ID, and is
sealed as `acceptedDryRunsHash`; parallel identifier/hash arrays are forbidden.

## 14. D-PR9-09 — Exact database object set

**Status:** `GATE A DESIGN ASSUMPTION PENDING`

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
Unique keys: `(authorityId, authorityVersion)`, `recordHash`. The additional
relational parent key `(recordId, authorityVersion, recordHash, companyId,
branchId)` is unique so every consumer binds one exact scoped authority version
without trusting caller JSON. Composite FKs: `(companyId, branchId)` to canonical
branches; `previousRecordId` to the same table. Checks enforce version sequence
inputs, hashes, concrete branch, JSON arrays, time order and credential nullability.

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
sourceAdapterAuthorityRecordId TEXT NOT NULL
sourceAdapterAuthorityVersion INTEGER NOT NULL
sourceAdapterAuthorityRecordHash TEXT NOT NULL
sourceOwnershipManifestHash TEXT NOT NULL
producerAuthorityRecordId TEXT NOT NULL
postingAuthorityRecordId TEXT NOT NULL
eventSchemaVersion TEXT NOT NULL
operationType TEXT NOT NULL
primaryEffectTablesJson TEXT NOT NULL
denialEvidenceTable TEXT NOT NULL
denialEvidencePermission TEXT NOT NULL
forbiddenOperationsJson TEXT NOT NULL
policyManifestHashesJson TEXT NOT NULL
evidencePackHash TEXT NOT NULL
acceptedDryRunsJson TEXT NOT NULL
acceptedDryRunsHash TEXT NOT NULL
amountBasisPolicyRef TEXT NOT NULL
amountBasisPolicyHash TEXT NOT NULL
dueDatePolicyId TEXT NOT NULL
dueDatePolicyVersion INTEGER NOT NULL
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
`canonical_receivable.initial_post.v1`; primary-effect tables are exactly sorted
`canonical_receivable_posting_operations`, `canonical_receivables`,
`financial_audit_events`. The denial-evidence table is exactly
`canonical_receivable_posting_conflicts` and its only permission is
`canonical_receivable_posting_conflicts.append_after_denial.v1`; it is never a
primary-effect table. Unique keys: `(authorizationId, authorizationVersion)`,
`recordHash`. Composite scope FKs plus exact scoped/versioned/hash-bound FKs to the
source, producer and posting authority records and PR6 activation boundary are
mandatory.

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
forwardOnlyStartUtc TEXT NOT NULL
boundaryEndUtc TEXT NULL
companyTimezoneSnapshot TEXT NOT NULL
sourceSystemIdsJson TEXT NOT NULL
allowedDocumentClassesJson TEXT NOT NULL
allowedRentalClassesJson TEXT NOT NULL
currency TEXT NOT NULL
explicitExclusionsJson TEXT NOT NULL
cohortHash TEXT NOT NULL
boundaryHash TEXT NOT NULL
policyManifestHashesJson TEXT NOT NULL
acceptedDryRunsHash TEXT NOT NULL
dueDatePolicyId TEXT NOT NULL
dueDatePolicyVersion INTEGER NOT NULL
dueDatePolicyHash TEXT NOT NULL
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
economicSourceKey TEXT NOT NULL
eventSchemaVersion TEXT NOT NULL
eventVersion INTEGER NOT NULL
dryRunId TEXT NOT NULL
candidateId TEXT NOT NULL
candidateResultHash TEXT NOT NULL
completeInputSetHash TEXT NOT NULL
policyManifestHash TEXT NOT NULL
sourceOwnershipManifestHash TEXT NOT NULL
acceptedDryRunsHash TEXT NOT NULL
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
companyTimezoneSnapshot TEXT NOT NULL
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
dueDatePolicyId TEXT NOT NULL
dueDatePolicyVersion INTEGER NOT NULL
dueDatePolicyHash TEXT NOT NULL
sourceAdapterAuthorityRecordId TEXT NOT NULL
sourceAdapterAuthorityVersion INTEGER NOT NULL
sourceAdapterAuthorityRecordHash TEXT NOT NULL
producerAuthorityRecordId TEXT NOT NULL
writeAuthorizationRecordId TEXT NOT NULL
sourceLineageHash TEXT NOT NULL
correlationId TEXT NOT NULL
eventHash TEXT NOT NULL
schemaVersion INTEGER NOT NULL
occurredAt TEXT NOT NULL
createdAt TEXT NOT NULL
```

Unique keys: `(companyId, economicSourceKey)`, `(companyId, eventHash)`, and exact
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
economicSourceKey TEXT NOT NULL
sourceAdapterAuthorityRecordId TEXT NOT NULL
sourceAdapterAuthorityVersion INTEGER NOT NULL
sourceAdapterAuthorityRecordHash TEXT NOT NULL
sourceOwnershipManifestHash TEXT NOT NULL
postingAuthorityRecordId TEXT NOT NULL
writeAuthorizationRecordId TEXT NOT NULL
activationRecordId TEXT NOT NULL
acceptedDryRunsHash TEXT NOT NULL
dueDatePolicyId TEXT NOT NULL
dueDatePolicyVersion INTEGER NOT NULL
dueDatePolicyHash TEXT NOT NULL
canonicalReceivableId TEXT NOT NULL
canonicalReceivableFingerprint TEXT NOT NULL
sourceLineageHash TEXT NOT NULL
commandFingerprint TEXT NOT NULL
auditPayloadFingerprint TEXT NOT NULL
auditEventFingerprint TEXT NOT NULL
resultHash TEXT NOT NULL
financialAuditEventId TEXT NOT NULL
correlationId TEXT NOT NULL
schemaVersion INTEGER NOT NULL
createdAt TEXT NOT NULL
```

Operation is exactly `canonical_receivable.initial_post.v1`. Unique keys:
`(companyId, operationType, idempotencyKey)`, `eventId`, `economicSourceKey`, and
`canonicalReceivableId`, plus `financialAuditEventId`. Composite FKs connect event, source/producer/posting
authority bindings, authorization, activation, canonical receivable and financial
audit.

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
economicSourceKey TEXT NOT NULL
existingReceivableId TEXT NULL
existingOperationId TEXT NULL
conflictObservationJson TEXT NOT NULL
conflictObservationHash TEXT NOT NULL
expectedFingerprint TEXT NOT NULL
observedFingerprint TEXT NOT NULL
sourceAdapterAuthorityRecordId TEXT NOT NULL
sourceAdapterAuthorityVersion INTEGER NOT NULL
sourceAdapterAuthorityRecordHash TEXT NOT NULL
sourceOwnershipManifestHash TEXT NOT NULL
postingAuthorityRecordId TEXT NOT NULL
writeAuthorizationRecordId TEXT NOT NULL
activationRecordId TEXT NOT NULL
acceptedDryRunsHash TEXT NOT NULL
sourceLineageHash TEXT NOT NULL
correlationId TEXT NOT NULL
detectorVersion TEXT NOT NULL
conflictHash TEXT NOT NULL
schemaVersion INTEGER NOT NULL
detectedAt TEXT NOT NULL
createdAt TEXT NOT NULL
```

Conflict type is exactly one of `ECONOMIC_SOURCE_EVENT_MISMATCH`,
`SOURCE_ADAPTER_REVOKED`, `SOURCE_ADAPTER_SUPERSEDED`,
`SOURCE_OWNERSHIP_MANIFEST_MISMATCH`, `PR6_LINEAGE_DRIFT`,
`PR8_EVIDENCE_MISMATCH`, `DUE_DATE_POLICY_DRIFT`, `COMPANY_TIMEZONE_DRIFT`,
`AUTHORIZATION_DRIFT`, `ACTIVATION_DRIFT`, `IDEMPOTENCY_CONTENT_CONFLICT` or
`AUDIT_SEAL_MISMATCH`. No generic or implementation-selected conflict label is
accepted. Severity is always `p0`; unique key is `(companyId, conflictHash)`.

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
| authorization `primaryEffectTablesJson` | exactly sorted `canonical_receivable_posting_operations`, `canonical_receivables`, `financial_audit_events` |
| authorization `denialEvidenceTable` | `canonical_receivable_posting_conflicts` |
| authorization `denialEvidencePermission` | `canonical_receivable_posting_conflicts.append_after_denial.v1` |
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

Authorization, activation, event and operation rows require the same non-empty
`dueDatePolicyId`, positive integer `dueDatePolicyVersion` and 64-hex
`dueDatePolicyHash` reconstructed from the accepted PR8 policy manifest. Activation
requires a valid IANA `companyTimezoneSnapshot`, exact RFC3339-millisecond
`forwardOnlyStartUtc`, nullable later `boundaryEndUtc`, and exact derivation from its
civil `forwardOnlyStartDate`; event timezone snapshots must also be valid IANA names.

For operation rows, all fields are non-null, all identities/hashes revalidate, and
the exact event, source key and canonical receivable each seal at most one operation.
For conflict rows, nullable references are permitted only when the referenced row
does not exist; otherwise scope and identity must match. Expected and observed
fingerprints must differ; `conflictObservationJson` must be exact canonical
`ConflictObservationV1` and reproduce its observation/expected/observed hashes. All
source, policy, lineage, command, result, record,
approval, cohort, boundary and evidence hashes are lowercase 64-hex values.

`acceptedDryRunsJson` is a canonical JSON array of objects with exactly the keys
`dryRunId` and `resultHash`, sorted by `dryRunId`, with no duplicate `dryRunId` and
one lowercase 64-hex result hash per ID. `acceptedDryRunsHash` must equal the exact
section 22 envelope in authorization, activation, event and operation/conflict
records. An ID and result hash can never be validated independently.

The exact foreign keys all use `ON UPDATE RESTRICT ON DELETE RESTRICT`:

| Child | Child columns → exact parent columns |
|---|---|
| every PR9 table | `companyId` → `canonical_companies(id)`; `(companyId, branchId)` → `canonical_branches(companyId, id)` |
| governed authority | `previousRecordId` → `governed_adapter_authority_records(recordId)` |
| write authorization | `previousRecordId` → same table `recordId`; `(activationBoundaryId, companyId, branchId)` → `billing_source_activation_boundaries(id, companyId, branchId)`; source binding `(sourceAdapterAuthorityRecordId, sourceAdapterAuthorityVersion, sourceAdapterAuthorityRecordHash, companyId, branchId)` → the exact governed authority composite key; producer/posting IDs → governed authority `recordId` plus the scope/kind/current-version trigger checks below |
| posting activation | `previousRecordId` → same table `recordId`; `(activationBoundaryId, companyId, branchId)` → `billing_source_activation_boundaries(id, companyId, branchId)`; `writeAuthorizationRecordId` → write authorization `recordId` |
| eligible event PR8 | `(dryRunId, companyId, branchId)` → `actual_source_dry_runs(id, companyId, branchId)`; `(candidateId, dryRunId, companyId, branchId)` → `actual_source_dry_run_candidates(id, runId, companyId, branchId)` |
| eligible event PR6 | each of `activationBoundaryId`, `rentalLineId`, `periodId`, `closedPeriodVersionId`, `snapshotId`, `updId`, `formedUpdVersionId`, `conductedUpdVersionId`, `updLineId`, `updLineVersionId`, `coverageSetId`, `coverageSliceId` with `(companyId, branchId)` → the same-ID scoped key of the corresponding `billing_source_*` table |
| eligible event PR9 | `activationRecordId` → posting activation `recordId`; source binding composite → the exact governed authority composite key; `producerAuthorityRecordId` → governed authority `recordId` plus trigger checks; `writeAuthorizationRecordId` → write authorization `recordId` |
| posting operation | `eventId` → eligible event `id`; source binding composite → exact governed authority composite key; `postingAuthorityRecordId` → governed authority `recordId` plus trigger checks; `writeAuthorizationRecordId` → write authorization `recordId`; `activationRecordId` → posting activation `recordId`; `(companyId, canonicalReceivableId, branchId)` → `canonical_receivables(companyId, id, branchId)`; `(financialAuditEventId, companyId, branchId)` → `financial_audit_events(id, companyId, branchId)` deferred until commit |
| posting conflict | nullable `eventId` → eligible event `id`; nullable `existingOperationId` → posting operation `id`; nullable `(companyId, existingReceivableId, branchId)` → `canonical_receivables(companyId, id, branchId)`; source binding composite plus posting authority, authorization and activation IDs → their exact scoped PR9 records |

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
| `uq_pr9_adapter_authority_binding` | yes | `recordId, authorityVersion, recordHash, companyId, branchId` |
| `idx_pr9_adapter_authority_scope` | no | `companyId, branchId, adapterKind, status, expiresAt` |
| `uq_pr9_write_authorization_version` | yes | `authorizationId, authorizationVersion` |
| `uq_pr9_write_authorization_hash` | yes | `recordHash` |
| `idx_pr9_write_authorization_scope` | no | `companyId, branchId, status, expiresAt` |
| `uq_pr9_activation_version` | yes | `activationId, activationVersion` |
| `uq_pr9_activation_hash` | yes | `recordHash` |
| `idx_pr9_activation_scope` | no | `companyId, branchId, status, expiresAt` |
| `uq_pr9_eligible_economic_source` | yes | `companyId, economicSourceKey` |
| `uq_pr9_eligible_event_hash` | yes | `companyId, eventHash` |
| `uq_pr9_eligible_candidate` | yes | `dryRunId, candidateId` |
| `idx_pr9_eligible_scope` | no | `companyId, branchId, createdAt` |
| `uq_pr9_posting_operation_idempotency` | yes | `companyId, operationType, idempotencyKey` |
| `uq_pr9_posting_operation_event` | yes | `eventId` |
| `uq_pr9_posting_operation_source` | yes | `companyId, economicSourceKey` |
| `uq_pr9_posting_operation_receivable` | yes | `canonicalReceivableId` |
| `uq_pr9_posting_operation_audit` | yes | `financialAuditEventId` |
| `idx_pr9_posting_operation_scope` | no | `companyId, branchId, createdAt` |
| `uq_pr9_posting_conflict_hash` | yes | `companyId, conflictHash` |
| `idx_pr9_posting_conflict_scope` | no | `companyId, branchId, detectedAt` |
| `uq_pr9_financial_audit_scope_parent` | yes | `financial_audit_events.id, companyId, branchId` |

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
trg_pr9_write_authorization_source_adapter_validate
trg_pr9_event_source_adapter_validate
trg_pr9_operation_source_adapter_validate
trg_pr9_conflict_source_adapter_validate
trg_pr9_event_before_operation_seal
trg_pr9_operation_finalize
trg_pr9_financial_audit_scope_validate_after_insert
trg_pr9_canonical_receivable_no_delete
trg_pr9_canonical_receivable_full_immutability
```

Exact trigger table/timing is:

| Trigger group | Table | Timing/event |
|---|---|---|
| each `*_no_update` / `*_no_delete` / `*_no_replace` | table named in trigger | `BEFORE UPDATE` / `BEFORE DELETE` / `BEFORE INSERT` |
| `trg_pr9_adapter_authority_version_chain` | `governed_adapter_authority_records` | `BEFORE INSERT` |
| `trg_pr9_write_authorization_version_chain` | `canonical_write_authorization_records` | `BEFORE INSERT` |
| `trg_pr9_activation_version_chain` | `canonical_posting_activation_records` | `BEFORE INSERT` |
| `trg_pr9_write_authorization_source_adapter_validate` | `canonical_write_authorization_records` | `BEFORE INSERT` |
| `trg_pr9_event_source_adapter_validate` | `actual_receivable_eligible_events` | `BEFORE INSERT` |
| `trg_pr9_operation_source_adapter_validate` | `canonical_receivable_posting_operations` | `BEFORE INSERT` |
| `trg_pr9_conflict_source_adapter_validate` | `canonical_receivable_posting_conflicts` | `BEFORE INSERT` |
| `trg_pr9_event_before_operation_seal` | `canonical_receivable_posting_operations` | `BEFORE INSERT` |
| `trg_pr9_operation_finalize` | `canonical_receivable_posting_operations` | `BEFORE INSERT` |
| `trg_pr9_financial_audit_scope_validate_after_insert` | `financial_audit_events` | `AFTER INSERT`; activates when an operation references `NEW.id`, regardless of `NEW.eventType` |
| `trg_pr9_canonical_receivable_no_delete` | `canonical_receivables` | `BEFORE DELETE`, only for the PR9 source system |
| `trg_pr9_canonical_receivable_full_immutability` | `canonical_receivables` | `BEFORE UPDATE`, only for the PR9 source system |

Every table-local trigger aborts rather than ignores the prohibited statement.
`no_replace` rejects an insert whose primary key or business unique key already
exists; repositories must classify replay before insert. The version-chain triggers
require version 1 with no predecessor or exact contiguous version N+1 linked to the
latest N row. The event-before-operation trigger requires the exact event/hash and
current authority chain. The four table-specific source-adapter binding triggers
apply before insert on authorization, event, operation and conflict respectively.
Each requires the composite ID, version, record hash, company and branch to name
the exact scoped `source_adapter` record with operation `source_lineage.read.v1`,
exact logical source system, source row classes, artifact digest, commit,
configuration, policy and ownership manifest expected by the row. The first three
also require the latest record to be currently `authorized`; the conflict trigger
verifies the immutable denied-attempt binding even when a terminal lifecycle was
the reason for denial and grants no primary effect.

The operation-finalize trigger validates the internally constructed canonical,
audit-payload and prospective audit-event fingerprints and the deferred audit
reference; final persisted equality is enforced by the later audit trigger, deferred
FK and repository reread. `trg_pr9_financial_audit_scope_validate_after_insert` is
an audit-side `AFTER INSERT` guard whose exact activation predicate is:

```text
EXISTS (
  SELECT 1
  FROM canonical_receivable_posting_operations AS operation
  WHERE operation.financialAuditEventId = NEW.id
)
```

The predicate deliberately does not inspect `NEW.eventType`, company or branch; a
wrong value must enter the trigger and abort rather than bypass it. The unique
operation index on `financialAuditEventId` and the trigger both require exactly one
referencing operation. Inside the trigger, the audit row must have exact
`eventType = canonical_receivable.initial_posted.v1`, company ID, branch ID,
correlation ID, `aggregateType = canonical_receivable`, aggregate/canonical ID,
`actorId = integration:rentcore-canonical-receivable-posting`, integration actor
type, payload `actorAuthorityRecordId = operation.postingAuthorityRecordId`, exact
authority/event identities, canonical payload fingerprint and prospective
audit-event fingerprint equal to the operation seal. Wrong event type, scope,
correlation, aggregate, actor identity, actor authority, payload, fingerprint or
multiple incompatible operation references aborts. Equivalent enforcement must be
proven if SQLite limitations require more than one named trigger. The audit FK is
`DEFERRABLE INITIALLY
DEFERRED`, allowing the mandated canonical → operation → audit insertion order
while still failing before commit if the audit row is absent, cross-scope or
different. Existing audit append-only guards remain authoritative.

The last two cross-object triggers apply only when
`canonical_receivables.sourceSystem = 'rentcore.billing_source_authority.v1'`.
Every field on those PR9-created rows is immutable and deletion is forbidden.

Registered rerun compares exact columns, ordered composite FKs, checks, unique keys,
index metadata and semantic trigger SQL. Drift fails closed without repair or
timestamp mutation. There is no down migration.

## 15. D-PR9-10 — Event-to-canonical mapping

**Status:** `GATE A DESIGN ASSUMPTION PENDING`

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
| `externalId` | event `economicSourceKey` | unique within company |
| economic source key | event `economicSourceKey`; mapped to `externalId` | policy-independent identity; changed content is P0 conflict |
| `idempotencyKey` | repository-derived `CanonicalPostingIdempotencyKeyV1` from section 22.10 | caller value forbidden; same source with changed event is conflict |
| `currency` | `RUB` | other currency blocks |
| `originalAmountMinor` | event `grossAmountMinor` | must equal approved event basis |
| `issuedAt` | current conducted UPD version `createdAt` | source drift blocks |
| `postedAt` | repository transaction timestamp | generated once |
| `contractualDueDate` | event date or null for approved unknown | difference blocks |
| `dueDateProvenance` | event provenance | difference blocks |
| due-date policy binding | event `dueDatePolicyId`/`dueDatePolicyVersion`/`dueDatePolicyHash`; sealed in operation/audit | any mixed or changed member is `DUE_DATE_POLICY_DRIFT` |
| `companyTimezone` | event `companyTimezoneSnapshot`, originally copied from locked PR5 company authority | fresh PR5 mismatch/unavailability blocks; never copy a newer mutable value |
| `workflowStatus` | literal `posted` | draft forbidden |
| `description` | literal `Governed UPD coverage slice` | no customer data |
| `createdAt`, `updatedAt` | same repository transaction timestamp | immutable |
| `version` | `1` | immutable |
| correlation ID | event/operation/audit only | PR1 row has no column |

`cancellationReason`, `cancelledAt`, `closedAt` and `writtenOffAt` are null. A
conflict under any mapped field creates no second receivable and no update.

## 16. D-PR9-11 — Canonical immutability

**Status:** `GATE A DESIGN ASSUMPTION PENDING`

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

**Status:** `GATE A DESIGN ASSUMPTION PENDING`

**Recommended decision:** the primary posting transaction rolls back completely on
conflict: canonical, operation and financial-audit writes are all zero. After that
rollback, a separate repository-owned `BEGIN IMMEDIATE` may append exactly one
deduplicated `CanonicalPostingConflictV1` row. Failure to persist conflict evidence
never permits posting; it raises a P0 telemetry failure and opens the circuit.

Primary-effect authority and denial-evidence authority are separate. The write
authorization enumerates the three primary-effect tables independently from the
single denial table and grants only the exact repository-owned append permission
`canonical_receivable_posting_conflicts.append_after_denial.v1`. After a
deterministic denial, the repository must open a new transaction, reread that exact
permission and all source/posting authority, authorization, activation and scope
bindings, and derive the conflict internally. A caller cannot select the table,
permission, operation, type, fingerprints or timestamps. A terminal primary-write
authorization never permits a primary effect; the denial append is permitted only
when the exact authorization version that governed the denied attempt remains
verifiably bound to this explicit denial-evidence permission.

Conflict evidence contains only stable IDs, hashes, exact enums/states, safe integer
versions and the validated IANA timezone projection; it contains no names, contact
data, amount payload JSON, credentials or free-form source content. Required numeric
amounts are represented only through expected/observed fingerprints. Every row
persists the exact canonical, repository-derived `ConflictObservationV1` from
section 22.8 plus its observation/expected/observed fingerprints; callers supply
none of those values. It is retained
indefinitely, is legal-hold eligible, append-only and hash-deduplicated. Exact replay
creates no conflict; same `conflictHash` returns the prior conflict identity.
Admission is bounded by the same 30-attempt scope limit, conflict writes are
deduplicated before insert, and the exact immediate-versus-five-in-five circuit
classification is the section-22.8 registry; no caller or implementation may
reclassify it. Gate C must revalidate the
retention period, legal-hold/privacy treatment, telemetry destination and incident
ownership; Gate A supplies no production sufficiency for those controls.

Financial audit records successful canonical effects. Conflict records prove denied
attempts and are not financial effects.

## 18. D-PR9-13 — Source change after posting

**Status:** `GATE A DESIGN ASSUMPTION PENDING`

PR9 performs no background monitoring. On a later attempt/replay, it detects current
PR6 reopen, cancellation, correction, supersession, amount/due-date change, missing
source row, source hash drift or authority revocation. It blocks new posting, writes
no canonical effect and records the approved conflict evidence.

If the canonical row already exists, PR9 never updates or deletes it. The condition
is a P0 post-posting source-change incident for reconciliation and a future
correction/compensation PR. Its conflict evidence uses the exact root type from
`ConflictObservationV1`—for example `PR6_LINEAGE_DRIFT`,
`DUE_DATE_POLICY_DRIFT` or `SOURCE_ADAPTER_REVOKED`—rather than inventing a generic
label. PR9 may expose only the immutable conflict and existing operation identities
to that future workflow. Authority revocation stops future attempts but does not
invalidate or erase prior committed evidence.

## 19. D-PR9-14 — Operational thresholds

**Status:** `GATE A LOCAL/DISABLED SAFE-DEFAULT ASSUMPTION PENDING; GATE C
PRODUCTION VALUES REVALIDATION REQUIRED`

Recommended v1 numbers:

| Control | Exact limit |
|---|---:|
| admission | 30 posting attempts per company/branch per rolling minute |
| accepted events per PR8 run | 100 |
| writes per posting transaction | 1 receivable |
| active posting concurrency | 1 per company/branch; SQLite still serializes global writers |
| SQLite `busy_timeout` | 5,000 ms |
| automatic repository retry | 0; caller may resubmit the same event/selectors, and the repository derives the same idempotency key |
| inert input bytes | 262,144 |
| inert depth | 24 |
| inert nodes | 10,000 |
| event freshness | 15 minutes from PR8 `finalizedAt` to event-production start |
| authority/authorization/activation max lifetime | 24 hours |
| free-space stop | below max of 512 MiB or 20% of mounted volume |
| DB+WAL daily-growth stop | 64 MiB per UTC day |
| conflict circuit breaker | immediate for the ten section-22.8 integrity types; 5 `AUTHORIZATION_DRIFT`/`ACTIVATION_DRIFT` conflicts in 5 minutes per company/branch |
| audit/conflict persistence failure | immediate circuit open |
| blocker-rate alert | at least 1 blocked posting in 5 minutes |
| latency warning | transaction over 2 seconds |
| latency stop | transaction over 5 seconds |

The future isolated foundation contains validation constants and tests only. No
runtime admission controller, scheduler or production metric wiring belongs to PR9.
Activation remains blocked until an operations layer enforces and observes these
exact limits.

## 20. D-PR9-15 — Retention, legal and incident controls

**Status:** `GATE A DESIGN ASSUMPTION PENDING; GATE C PRODUCTION POLICY
REVALIDATION REQUIRED`

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

These values are design assumptions only. Gate A does not make them legally,
privacy, security or operationally sufficient for production. Gate C must replace
or revalidate the exact production retention, legal-hold, RPO/RTO, custody and
incident values through the responsible role-scoped approvals.

## 21. D-PR9-16 — PR structure

**Status:** `GATE A DESIGN ASSUMPTION PENDING`

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

Neither PR is authorized by this document. PR9a requires a separate Gate B owner
authorization naming exact scope and base SHA. PR9b additionally requires an
independently released PR9a, Gate C production policy/evidence closure and its own
exact implementation authorization. Gate D remains mandatory before any deployment,
production PR8 execution, Railway mutation or canonical write activation.

## 22. Exact contract envelopes

### 22.1 Byte contract and envelope registry

Every envelope below is a plain object with exactly the listed keys and no extras.
`domain` and `version` are mandatory anti-confusion fields. Canonical JSON applies
section 5 recursively: object keys are emitted in ASCII byte order; arrays retain
only their contract-defined order; JSON null is the four UTF-8 bytes `null` and is
never omitted or replaced by an empty string; booleans are `true`/`false`; integers
are base-10 JSON integers with no sign padding, exponent or decimal point; strings
use JSON escaping and their original validated Unicode code points. Hash input is
the exact UTF-8 byte sequence of that canonical JSON, with no BOM or trailing byte.

For each envelope PR9a fixtures must publish the exact canonical byte string and
lowercase SHA-256 hex, including null, escaping, array-order and maximum-safe-integer
cases. A field not listed in an envelope is excluded; there are no implicit fields.

### 22.2 `GovernedAdapterAuthorityV1`

Required fields are every authority column; only `previousRecordId`,
`credentialFingerprint`, `credentialIssuerRef` and `revocationReasonCode` may be
null under their enum rules. Identity is `authorityId + authorityVersion`.
`recordHash` uses domain `rentcore.governed_adapter_authority.record`, version `1`
and exactly:

```text
{ actorId, adapterKind, allowedOperation, approvalHash, approvalRef,
  artifactDigest, authorityId, authorityVersion, branchId, companyId,
  configurationHash, credentialFingerprint, credentialIssuerRef, credentialType,
  domain, effectiveFrom, environment, expiresAt, ownerRef, policyHash,
  previousRecordId, revocationReasonCode, schemaVersion, sourceCommitSha,
  sourceRowClassesJson, sourceSystemIdsJson, status, version }
```

The exact exclusions are `recordId`, `recordHash` and `createdAt`. Latest means the
highest contiguous version whose
predecessor chain matches; same identity/content replays, changed content conflicts,
and a terminal/current mismatch blocks.

### 22.3 Accepted PR8 pair set

`acceptedDryRunsHash = sha256(canonicalJson({acceptedDryRuns,domain,version}))`,
where `domain = rentcore.canonical_actual_posting.accepted_dry_runs`, `version = 1`
and `acceptedDryRuns` is a non-empty array of objects with exactly `dryRunId` and
`resultHash`, sorted ascending by `dryRunId` ASCII bytes with no duplicate ID.
Authorization creation and every locked event/posting/conflict validation reread
the persisted PR8 run result and match both members of every accepted pair.

### 22.4 `sourceLineageHash`

`sourceLineageHash` uses domain
`rentcore.canonical_actual_posting.source_lineage`, version `1`, and exactly:

```text
{ acceptedDryRunsHash, activationBoundaryId, branchId, candidateId,
  candidateResultHash, closedPeriodVersionId, companyId, completeInputSetHash,
  conductedUpdVersionId, coverageSetId, coverageSliceId, domain, dryRunId,
  formedUpdVersionId, periodId,
  pr6LineageRows:[{rowFingerprint,rowId,rowVersion,tableName}],
  snapshotId,
  sourceAdapterAuthority:{authorityVersion,recordHash,recordId},
  sourceOwnershipManifestHash, sourceSystem, updId, updLineId,
  updLineVersionId, version }
```

`pr6LineageRows` is not a caller-selected path. It contains (a) every row reached by
the event's explicit PR6 IDs, (b) every row sharing any reached logical identity,
parent ID or coverage interval that can be its latest version, predecessor,
successor, supersession, reopen, cancellation, correction, overlap or duplicate.
An absent competing row contributes no array member; a later inserted matching row
adds a member and therefore changes the hash. The repository reconstructs this set
from all 16 PR6 tables:
`billing_source_activation_boundaries`,
`billing_source_rental_lines`, `billing_source_effective_terms`,
`billing_source_periods`, `billing_source_period_versions`,
`billing_source_snapshots`, `billing_source_snapshot_evidence`,
`billing_source_upds`, `billing_source_upd_versions`,
`billing_source_upd_lines`, `billing_source_upd_line_versions`,
`billing_source_coverage_sets`, `billing_source_coverage_supersessions`,
`billing_source_coverage_slices`, `billing_source_operations` and
`billing_source_audit_events`. It is sorted by `tableName`, `rowId`, then
`rowVersion`; table/ID use ascending ASCII bytes and JSON null sorts before positive
integer versions. Nullable source versions are JSON null. The
repository rereads each row class, its ownership/upstream ID, latest lifecycle and
all competing successors/overlaps under lock and rejects any upstream ID or row
class outside the bound source-adapter authority.

For each member, `rowFingerprint` is SHA-256 of the exact canonical object
`{columns,domain,rowId,rowVersion,tableName,version}` where domain is
`rentcore.billing_source_authority.persisted_row`, version is `1`, and `columns` is
an array of `{columnName,value}` for every stored `hidden=0` column returned by
`PRAGMA table_xinfo(tableName)` in ascending `cid`, including IDs, scope, lifecycle,
owner, upstream-source, policy, evidence, content hashes and timestamps. No column
is excluded. `columnName` must equal the registered PR6 v1 schema; SQLite NULL maps
to JSON null, INTEGER to a safe JSON integer and TEXT to its exact string; any REAL,
BLOB, unknown column, missing column or schema drift denies before hashing. The
array-order fixture for each of all 16 row classes is mandatory.

### 22.5 `ActualReceivableEligibleV1`

The policy-independent identity is:

```text
economicSourceKey = sha256(canonicalJson({
  branchId, companyId, contractId, coverageEndExclusive, coverageStart,
  currency, domain, rentalId, rentalLineId, schemaVersion, sourceDocumentId,
  sourceDocumentType, sourceDocumentVersion, sourceLineId, sourceSystem, version
}))
```

Here `domain = rentcore.canonical_actual_posting.economic_source_key`, envelope
`version = 1`, `sourceDocumentType = upd_coverage_slice_v1`,
`sourceDocumentId = updId`, `sourceDocumentVersion = conductedUpdVersionId`,
`sourceLineId = coverageSliceId`, `coverageStart = sliceStartDate`, and
`coverageEndExclusive = sliceEndDateExclusive`. The key explicitly excludes amount,
due date/provenance/evidence, every policy hash, PR8 acceptance, adapter/producer/
posting authority, write authorization, activation, lifecycle status, timestamps,
generated IDs and correlation. `(companyId, economicSourceKey)` is unique.

`eventHash` uses domain `rentcore.canonical_actual_posting.eligible_event`, version
`1`, and every persisted event field in section 14 except exactly generated `id`
and `eventHash`, plus `domain` and envelope `version`.
Therefore its exact ordered member set is: `acceptedDryRunsHash`,
`activationBoundaryId`, `activationCohortRef`, `activationRecordId`, `amountBasis`,
`amountBasisPolicyHash`, `amountBasisPolicyRef`, `branchId`, `candidateId`,
`candidateResultHash`, `clientId`, `closedPeriodVersionId`, `cohortHash`,
`companyId`, `companyTimezoneSnapshot`, `completeInputSetHash`,
`conductedUpdVersionId`, `contractId`,
`contractualDueDate`, `correlationId`, `coverageSetId`, `coverageSliceId`,
`createdAt`, `currency`, `domain`, `dryRunId`, `dueDateEvidenceRef`,
`dueDatePolicyHash`, `dueDatePolicyId`, `dueDatePolicyVersion`,
`dueDateProvenance`, `economicSourceKey`,
`eventSchemaVersion`, `eventVersion`, `formedUpdVersionId`, `grossAmountMinor`,
`netAmountMinor`, `occurredAt`, `originalAmountMinor`, `periodId`, `policyManifestHash`,
`producerAuthorityRecordId`, `rentalId`, `rentalLineId`, `schemaVersion`,
`sliceEndDateExclusive`, `sliceStartDate`, `snapshotId`,
`sourceAdapterAuthorityRecordHash`, `sourceAdapterAuthorityRecordId`,
`sourceAdapterAuthorityVersion`, `sourceLineageHash`,
`sourceOwnershipManifestHash`, `updId`, `updLineId`, `updLineVersionId`,
`vatAmountMinor`, `version`, `writeAuthorizationRecordId`.

For a new event, `occurredAt = createdAt = attemptedAt` and `correlationId` is the
pre-generated repository value. For replay comparison the repository uses the
existing event's persisted `occurredAt`, `createdAt` and `correlationId`, not the new
attempt clock or candidate ID, so generated attempt metadata remains sealed without
forking identity. Same economic key and event hash is exact replay. Same economic
key with any changed event content,
including amount, due-date, policy, evidence or authority, is one deterministic
conflict and never a second event. A changed or unavailable fresh PR5 timezone does
not alter the existing event; it denies replay/posting as `COMPANY_TIMEZONE_DRIFT`.

### 22.6 `CanonicalWriteAuthorizationV1` and activation

Required authorization fields are every column except nullable `previousRecordId`
and `revocationReasonCode`. Identity is `authorizationId + authorizationVersion`.
Its record hash uses domain `rentcore.canonical_actual_posting.write_authorization`,
version `1`, and exactly:

```text
{ acceptedDryRunsHash, acceptedDryRunsJson, activationBoundaryId,
  activationCohortRef, amountBasisPolicyHash, amountBasisPolicyRef,
  approvalSetJson, authorizationId, authorizationVersion, backupEvidenceRef,
  boundaryHash, branchId, cohortHash, companyId, denialEvidencePermission,
  denialEvidenceTable, domain, dueDatePolicyHash, dueDatePolicyId,
  dueDatePolicyVersion, effectiveFrom,
  eventSchemaVersion, evidencePackHash, expiresAt, forbiddenOperationsJson,
  operationType, operationalControlRef, policyManifestHashesJson,
  postingAuthorityRecordId, previousRecordId, primaryEffectTablesJson,
  producerAuthorityRecordId, retentionControlRef, revocationReasonCode,
  schemaVersion, sourceAdapterAuthorityRecordHash,
  sourceAdapterAuthorityRecordId, sourceAdapterAuthorityVersion,
  sourceOwnershipManifestHash, sourceSystemIdsJson, status, version }
```

The exact exclusions are `recordId`, `recordHash` and `createdAt`.
`authorizationHash` means this exact persisted `recordHash`; no second or
caller-computed authorization hash exists.
The due-date policy triple is the exact accepted PR8 manifest entry and is compared
as one unit during authorization creation and every Algorithm A/B/C reread; no
member may be independently supplied or mixed with another version.

The approval set must contain stable refs/hashes for product, accountant/finance,
legal, tax, security/identity, release/operations, source-adapter owner, producer
owner, posting-adapter owner and independent reconciliation reviewer. Gate A creates
none. Expiry/revocation blocks primary effects even on replay; denial evidence is
limited by section 17 and algorithm C.

`CanonicalPostingActivationV1` identity is `activationId + activationVersion`.
Its record hash uses domain `rentcore.canonical_actual_posting.activation`, version
`1`, and exactly:

```text
{ acceptedDryRunsHash, activationBoundaryId, activationId, activationVersion,
  allowedDocumentClassesJson, allowedRentalClassesJson, approvalHash, approvalRef,
  boundaryEndUtc, boundaryHash, branchId, cohortHash, companyId,
  companyTimezoneSnapshot, currency, domain, dueDatePolicyHash, dueDatePolicyId,
  dueDatePolicyVersion, effectiveFrom, explicitExclusionsJson, expiresAt,
  forwardOnlyStartDate, forwardOnlyStartUtc, policyManifestHashesJson,
  previousRecordId, revocationReasonCode, schemaVersion, sourceSystemIdsJson,
  status, version, writeAuthorizationRecordId }
```

`boundaryEndUtc` is the only additional nullable field and is JSON null for v1.
`activationHash` means this exact persisted `recordHash`; no parallel hash exists.
The exact exclusions are `recordId`, `recordHash` and `createdAt`. It seals
`acceptedDryRunsHash` and is default denied when missing, ambiguous, ineffective,
expired, revoked, superseded or mismatched. Deployment creates or selects no
activation.

### 22.7 Posting fingerprints

`commandFingerprint` has domain
`rentcore.canonical_actual_posting.command`, version `1`, and exactly:

```text
{ assertedDueDatePolicyHash, assertedDueDatePolicyId,
  assertedDueDatePolicyVersion, assertedEventHash,
  assertedWriteAuthorizationRecordId, branchId, companyId, domain, eventId,
  operationType,
  requestedActivationRecordId, requestedPostingAuthorityRecordId,
  requestedSourceAdapterAuthorityRecordId, version }
```

These are inert pre-lock selectors/assertions only; none decides authority. The
caller supplies no idempotency key: it is derived only after locked relational
reread by `CanonicalPostingIdempotencyKeyV1`.

`canonicalReceivableFingerprint` has domain
`rentcore.canonical_receivable.persisted_row`, version `1`, and every exact
persisted/generated PR1 field after reread:

```text
{ branchId, cancellationReason, cancelledAt, clientId, closedAt, companyId,
  companyTimezone, contractId, contractualDueDate, createdAt, currency,
  description, domain, dueDateProvenance, externalId, id, idempotencyKey,
  issuedAt, normalizedSourceLineId, originalAmountMinor, postedAt, rentalId,
  sourceDocumentId, sourceDocumentType, sourceLineId, sourceSystem, updatedAt,
  version, workflowStatus, writtenOffAt }
```

`auditPayloadFingerprint` uses domain
`rentcore.canonical_actual_posting.audit_payload`, version `1`, and exactly:

```text
{ activationRecordId, acceptedDryRunsHash, canonicalReceivableFingerprint,
  domain, dueDatePolicyHash, dueDatePolicyId, dueDatePolicyVersion,
  economicSourceKey, eventHash, eventId, operationId,
  postingAuthorityRecordId, sourceAdapterAuthorityRecordHash,
  sourceAdapterAuthorityRecordId, sourceAdapterAuthorityVersion,
  sourceLineageHash, sourceOwnershipManifestHash, version,
  writeAuthorizationRecordId }
```

The repository stores `newValueJson` as that exact listed object without
`domain`/`version` plus its `auditPayloadFingerprint`; no caller JSON is accepted.
For the composite audit seal, `auditEventId = financial_audit_events.id`,
`actorIdentityId = actorId = integration:rentcore-canonical-receivable-posting`, and
`actorAuthorityRecordId = postingAuthorityRecordId` in the payload/operation.
`aggregateType = canonical_receivable`, `aggregateId = canonicalReceivableId`,
`eventType = canonical_receivable.initial_posted.v1`, and company, branch,
correlation and payload fingerprint must all match the operation. The deferred FK
seals audit ID/company/branch; the audit-side `AFTER INSERT` trigger seals the
remaining fields after both rows exist.

`auditEventFingerprint` uses domain
`rentcore.canonical_actual_posting.financial_audit_event`, version `1`, and exactly:

```text
{ actorId, actorType, aggregateId, aggregateType, auditPayloadFingerprint,
  branchId, companyId, correlationId, createdAt, domain, eventType, id,
  occurredAt, previousValueJson, reason, sourceSystem, version }
```

This projection represents `newValueJson` only by its separately verified
`auditPayloadFingerprint`; every other persisted audit field is listed. There are no
other exclusions.

`resultHash` uses domain `rentcore.canonical_actual_posting.result`, version `1`,
and exactly:

```text
{ acceptedDryRunsHash, activationId, activationRecordHash, activationRecordId,
  attemptedAt, auditEventFingerprint, auditPayloadFingerprint, branchId,
  canonicalReceivableFingerprint, canonicalReceivableId, commandFingerprint,
  canonicalWriteAuthorizationId, companyId, correlationId, domain,
  dueDatePolicyHash, dueDatePolicyId, dueDatePolicyVersion, economicSourceKey,
  eventHash, eventId, financialAuditEventId, idempotencyKey, operationId,
  operationType,
  postingAuthorityRecordHash, postingAuthorityRecordId, schemaVersion,
  sourceAdapterAuthorityRecordHash, sourceAdapterAuthorityRecordId,
  sourceAdapterAuthorityVersion, sourceLineageHash,
  sourceOwnershipManifestHash, version,
  writeAuthorizationRecordHash, writeAuthorizationRecordId }
```

`CanonicalPostingOperationV1` identity is company + operation type + idempotency
key. Every operation column is required. `resultHash` excludes exactly itself; all
other projections above are reread and recomputed before commit. `resultHash` is the
operation's immutable seal hash; this is the operation hash for the posting chain,
and its literal source-adapter ID/version/hash fields satisfy the required authority
binding without introducing a second ambiguous operation hash.
Within that envelope, `attemptedAt` equals the persisted operation `createdAt`; for
a new result both equal the one locked clock value, while replay reuses that sealed
persisted value rather than the new attempt clock. Authority and activation record
hash members, logical `activationId`/`canonicalWriteAuthorizationId` and due-date
policy triple are obtained from the exact relational parents/event/operation during
persisted reread, never from command assertions.

### 22.8 `CanonicalPostingConflictV1`

`ConflictObservationV1` is a repository-owned plain object with exactly:

```text
{ domain, version, conflictType, expectedProjection, observedProjection }
```

`domain = rentcore.canonical_actual_posting.conflict_observation`, `version = 1`,
and `conflictType` must be one exact section-14 enum value. The repository persists
this object as exact canonical JSON in `conflictObservationJson` and computes
`conflictObservationHash = sha256(canonicalJson(ConflictObservationV1))`.
`expectedFingerprint` and `observedFingerprint` are independently computed as:

```text
sha256(canonicalJson({
  conflictType,
  domain: rentcore.canonical_actual_posting.conflict_expected,
  projection: expectedProjection,
  version: 1
}))

sha256(canonicalJson({
  conflictType,
  domain: rentcore.canonical_actual_posting.conflict_observed,
  projection: observedProjection,
  version: 1
}))
```

The exact projection registry is:

| `conflictType` | Exact keys in both projections | Expected authoritative source | Observed authoritative source / null rule |
|---|---|---|---|
| `ECONOMIC_SOURCE_EVENT_MISMATCH` | `{economicSourceKey,eventHash,eventId}` | locked attempted event reconstruction | persisted event at the economic/candidate identity; `eventId` is JSON null only when no row exists |
| `SOURCE_ADAPTER_REVOKED` | `{authorityId,authorityVersion,recordHash,status}` | exact authorization-bound source-adapter version with expected `authorized` | latest locked authority version with exact `revoked`; its record hash seals the reason without retaining it in observation JSON |
| `SOURCE_ADAPTER_SUPERSEDED` | `{authorityId,authorityVersion,recordHash,status}` | exact authorization-bound source-adapter version with expected `authorized` | latest locked successor with exact `superseded`; its record hash seals the reason without retaining it in observation JSON |
| `SOURCE_OWNERSHIP_MANIFEST_MISMATCH` | `{sourceOwnershipManifestHash}` | authorization/event sealed manifest | complete locked PR6 ownership reconstruction |
| `PR6_LINEAGE_DRIFT` | `{sourceLineageHash}` | event-sealed PR6 lineage | complete locked current 16-table PR6 reconstruction |
| `PR8_EVIDENCE_MISMATCH` | `{acceptedDryRunsHash,dryRunId,resultHash}` | authorization/activation accepted pair set and selected pair | locked PR8 run/result; `dryRunId` or `resultHash` is JSON null only when the referenced persisted row/member is absent |
| `DUE_DATE_POLICY_DRIFT` | `{bindingState,dueDatePolicyHash,dueDatePolicyId,dueDatePolicyVersion}` | event/authorization/activation exact policy triple with `bindingState=valid` | locked accepted PR8 `unknown_due_date_treatment` decision; state is `valid`, `missing` or `ambiguous`, and all three members are JSON null for the latter two |
| `COMPANY_TIMEZONE_DRIFT` | `{companyTimezone,timezoneState}` | event snapshot with `timezoneState=valid` | fresh locked PR5 value; state is `valid`, `missing`, `invalid`, `unavailable` or `ambiguous`, and timezone is JSON null unless state is `valid` |
| `AUTHORIZATION_DRIFT` | `{authorizationId,authorizationVersion,recordHash,status}` | event-bound authorization version expected `authorized` | latest locked authorization chain record |
| `ACTIVATION_DRIFT` | `{activationId,activationVersion,recordHash,status}` | event-bound activation version expected `authorized` | latest locked activation chain record |
| `IDEMPOTENCY_CONTENT_CONFLICT` | `{activationId,canonicalWriteAuthorizationId,economicSourceKey,eventHash,idempotencyKey,operationType}` | locked attempted operation projection | persisted operation at any colliding source/idempotency identity |
| `AUDIT_SEAL_MISMATCH` | `{actorAuthorityRecordId,actorIdentityId,aggregateId,auditEventFingerprint,auditEventId,auditPayloadFingerprint,branchId,companyId,correlationId,eventTypeFingerprint,eventTypeState}` | repository-constructed prospective audit seal with `eventTypeState=exact` | persisted audit/operation reconstruction; state is `exact`, `mismatch` or `missing`, and every other key is JSON null only when the audit row is wholly absent |

Projection keys are emitted in ASCII order by section 22.1. No other field is
allowed. Non-null IDs are validated opaque IDs, versions are positive safe integers,
statuses/types/states are exact enums, a non-null timezone is a validated IANA name
and fingerprints are lowercase SHA-256. JSON null is permitted only in the table
cases above; omission is forbidden. Invalid/unavailable raw timezone or policy
content is never retained. Projections contain no names, contacts, addresses, amounts, dates,
free-form reasons, credentials, tokens, source payloads or arbitrary caller JSON.
Ambiguous observations fail closed without inventing a conflict row.

For the audit projection, `eventTypeFingerprint` is SHA-256 of exactly
`{domain,eventType,version}` with domain
`rentcore.canonical_actual_posting.audit_event_type`, version `1`, and the validated
persisted event-type string; expected uses the required literal. A missing audit row
uses JSON null. The raw mismatching value is never retained in conflict JSON.

The repository derives the observation in Algorithm A or B before rollback, freezes
it as an unexported branded inert value, and Algorithm C reconstructs both sides from
persisted state before insert. Callers cannot create or select the type, projection,
fingerprint or table. When more than one invariant differs, the first matching type
in this exact precedence order is the sole observation:

```text
SOURCE_ADAPTER_REVOKED
SOURCE_ADAPTER_SUPERSEDED
AUTHORIZATION_DRIFT
ACTIVATION_DRIFT
SOURCE_OWNERSHIP_MANIFEST_MISMATCH
PR6_LINEAGE_DRIFT
PR8_EVIDENCE_MISMATCH
DUE_DATE_POLICY_DRIFT
COMPANY_TIMEZONE_DRIFT
IDEMPOTENCY_CONTENT_CONFLICT
AUDIT_SEAL_MISMATCH
ECONOMIC_SOURCE_EVENT_MISMATCH
```

No multi-row conflict fan-out or implementation-specific precedence is allowed.
Immediate circuit-open types are
`ECONOMIC_SOURCE_EVENT_MISMATCH`, both `SOURCE_ADAPTER_*` types,
`SOURCE_OWNERSHIP_MANIFEST_MISMATCH`, `PR6_LINEAGE_DRIFT`,
`PR8_EVIDENCE_MISMATCH`, `DUE_DATE_POLICY_DRIFT`, `COMPANY_TIMEZONE_DRIFT`,
`IDEMPOTENCY_CONTENT_CONFLICT` and `AUDIT_SEAL_MISMATCH`.
`AUTHORIZATION_DRIFT` and `ACTIVATION_DRIFT` open the circuit on the fifth conflict
within five minutes per company/branch. Every type remains severity `p0`.

`conflictHash` uses domain `rentcore.canonical_actual_posting.conflict`, version
`1`, and exactly:

```text
{ acceptedDryRunsHash, activationRecordHash, activationRecordId, branchId,
  companyId, conflictObservationHash, conflictType, detectorVersion, domain,
  economicSourceKey, eventHash, eventId,
  existingOperationId, existingReceivableId, expectedFingerprint,
  observedFingerprint, postingAuthorityRecordHash, postingAuthorityRecordId,
  schemaVersion,
  sourceAdapterAuthorityRecordHash, sourceAdapterAuthorityRecordId,
  sourceAdapterAuthorityVersion, sourceLineageHash,
  sourceOwnershipManifestHash, version,
  writeAuthorizationRecordHash, writeAuthorizationRecordId }
```

Generated `id`, `correlationId`, `detectedAt`, `createdAt`, `conflictHash`, and
severity (fixed `p0`) are the exact exclusions, so repeat detection deduplicates
despite a new attempt timestamp/correlation. Required nullable references are JSON
null when the row does not exist. The three parent record hashes are repository
values from the relational activation/posting-authority/write-authorization reread,
not caller fields. `conflictObservationJson` is represented only by its separately
verified `conflictObservationHash`; it is not hashed twice as raw JSON. Changed
semantic observation produces a new immutable conflict. PR9a fixtures publish exact
canonical bytes and SHA-256 for every projection row, both side envelopes, the full
observation and the resulting conflict hash.

### 22.9 Cross-contract field matrix

| Field/binding | Authoritative source | Persisted contracts | Hash envelopes | Locked reread | Replay/conflict role |
|---|---|---|---|---|---|
| `companyId`,`branchId` | PR5 relational scope | all six PR9 contracts + audit | every row/content hash | A, B and C reread composite parents | mismatch is conflict/denial, never cross-scope replay |
| source adapter ID/version/hash | latest governed source-adapter chain | authorization, event, operation, conflict; audit payload | authority record, event, audit payload/event, result, conflict | A/B verify active latest; C verifies exact immutable denial binding | terminal/drift denies primary; changed binding conflicts |
| `sourceOwnershipManifestHash` + upstream/row classes | complete PR6 ownership universe constrained by source adapter | authorization/event/operation/conflict; lineage rows | authorization record, source lineage, event, audit payload, result, conflict | A/B reconstruct all 16 tables; C verifies denial hashes | drift is deterministic source/authority conflict |
| accepted `{dryRunId,resultHash}` pairs | accepted PR8 record plus persisted PR8 result | authorization pairs/hash, activation/event/operation/conflict hash | accepted set, authorization/activation records, event, audit payload, result, conflict | A/B verify both members; C verifies denial binding | pair mix-and-match denies; exact set may replay |
| `AcceptedPr8EvidencePredicateV1` | locked PR8 run/candidate/seal/reconciliation graph plus accepted evidence record | referenced by authorization, activation and event pair/hash bindings | accepted set, authorization/activation/event/result/conflict hashes | A and B require the exact same predicate including `diagnosticOnly=true` and both write flags false | any false term denies; no PR8 flag is reinterpreted |
| `economicSourceKey` | repository projection of immutable PR6 coverage identity | event, canonical `externalId`, operation, conflict, audit payload | economic key, event, audit payload/event, result, conflict | A builds/queries; B recomputes; C verifies | same key/same hash replay; same key/different content conflicts |
| amount and due-date values | sealed PR6/PR8 source | event; mapped canonical row; operation/audit fingerprints | event, canonical, audit payload/event, result; conflict observations | A/B reconstruct under lock | excluded from economic key; any change conflicts |
| due-date policy ID/version/hash | accepted PR8 `unknown_due_date_treatment` manifest entry | authorization, activation, event and operation | authorization/activation/event/command/result plus due-policy conflict observation | A/B reread the exact canonical PR8 manifest; C reconstructs both observation sides | any ID/version/hash drift under the same economic key is deterministic conflict |
| `companyTimezoneSnapshot` | fresh locked PR5 company timezone at Algorithm A | activation and event; mapped canonical `companyTimezone` | activation/event, canonical/result and timezone conflict observation | A validates and snapshots; B compares fresh PR5 to event before replay or write | null/invalid/unavailable/change denies; canonical always receives event snapshot |
| cohort, boundary and idempotency identities | locked normalized activation/authorization/event parents | authorization, activation, event/operation | exact section 22.10 envelopes | A/B/C reconstruct logical arrays/IDs, never caller JSON/key | normalization drift denies; same source plus changed event is conflict |
| `ConflictObservationV1` | branded repository denial plus locked reconstruction | conflict JSON and observation/side fingerprints | observation, expected, observed and conflict hashes | C reconstructs exact registered projections | same observation deduplicates; any semantic change is a new conflict |
| producer authority | latest eligibility-producer chain | authorization and event | authority/authorization/event, then result through event | A/B reread latest; C verifies denial binding | terminal/drift denies event/posting |
| posting authority / audit actor authority | latest posting-adapter chain | authorization, operation, conflict, audit payload | authority/authorization, audit payload/event, result, conflict | B rereads active latest; C rereads exact denial binding | mismatch denies; exact prior result may replay only while current |
| write authorization + primary/denial permissions | latest authorization chain | authorization, activation, event, operation, conflict, audit payload | authorization/activation, event, audit payload/event, result, conflict | A/B require active primary; C rereads evidence-only permission | primary expiry denies; denial permission never creates success |
| `attemptedAt` | the single repository clock capability call immediately after each begin | new event/operation/canonical/audit or conflict operational timestamps | new event timestamps enter event hash; new posting time enters result; conflict timestamps remain excluded from dedupe | A, B and C validate exact operational floor once with no skew tolerance | equality with floor is allowed; regression denies; replay returns original timestamps and never forks identity |

No row may substitute a caller hash for a relational reread. The matrix is an
obligation to compare both sides inside the applicable locked transaction.

### 22.10 Cohort, boundary and idempotency envelopes

`CanonicalPostingCohortHashV1` computes `cohortHash` with domain
`rentcore.canonical_actual_posting.cohort`, envelope version `1`, and exactly:

```text
{ allowedDocumentClasses, allowedRentalClasses, branchIds, cohortVersion,
  companyId, currency, domain, explicitExclusions, forwardOnlyStartDate,
  policyManifestHashes, sourceSystems, version }
```

`cohortVersion = 1`. `branchIds` is the sorted unique logical array containing
exactly the activation's one concrete `branchId`. `sourceSystems`,
`allowedDocumentClasses`, `allowedRentalClasses`, `explicitExclusions` and
`policyManifestHashes` are logical arrays obtained by parsing their corresponding
canonical `*Json` columns. Every array is non-empty except
`explicitExclusions`, contains only validated non-null strings, rejects duplicates,
and is sorted by ascending ASCII bytes before hashing. The hash never consumes the
JSON text value itself. Exact exclusions are record/logical activation IDs and
versions, persisted `schemaVersion`, boundary hash, status, approval/evidence references, accepted dry runs,
authority IDs, lifecycle effective/expiry/revocation fields and repository
timestamps.

`CanonicalPostingBoundaryHashV1` computes `boundaryHash` with domain
`rentcore.canonical_actual_posting.boundary`, envelope version `1`, and exactly:

```text
{ boundaryEndUtc, boundaryVersion, branchIds, companyId,
  companyTimezoneSnapshot, currency, domain, exclusionRules,
  forwardOnlyStartDate, forwardOnlyStartUtc, sourceClass, sourceSystems, version }
```

`boundaryVersion = 1`, `sourceClass =
conducted_upd_validated_coverage_slice_v1`, `branchIds` and `sourceSystems` use the
same normalized logical arrays above, and `exclusionRules` is the normalized logical
value of `explicitExclusionsJson`. `forwardOnlyStartUtc` is the exact UTC instant of
`00:00:00.000` on `forwardOnlyStartDate` in `companyTimezoneSnapshot`, formatted as
RFC3339 UTC milliseconds. An invalid/nonexistent local start instant denies rather
than normalizes. `boundaryEndUtc` is JSON null for unbounded forward-only v1; a later
non-null value must be strictly greater than the start and requires a new boundary
version. No other null is allowed. Exact exclusions are cohort/policy/evidence
hashes, authorization/activation record or logical IDs and versions, status,
persisted `schemaVersion`, approval fields, `effectiveFrom`, `expiresAt`, revocation reason and timestamps:
activation expiry is a lifecycle gate, never source-boundary identity.

`CanonicalPostingIdempotencyKeyV1` computes `idempotencyKey` with domain
`rentcore.canonical_actual_posting.idempotency_key`, envelope version `1`, and
exactly:

```text
{ activationId, canonicalWriteAuthorizationId, domain, economicSourceKey,
  eventHash, operationType, version }
```

`activationId` is `canonical_posting_activation_records.activationId` and
`canonicalWriteAuthorizationId` is
`canonical_write_authorization_records.authorizationId`, both read from locked
relational parents; `operationType` is the exact initial-post literal. The
repository accepts no caller key and derives the value only after event,
authorization and activation reread. Attempt time, correlation, generated UUIDs,
record IDs, record/logical versions, persisted `schemaVersion`, authority status and
other mutable tags are exact exclusions. Same
inputs produce the same key. A changed `eventHash` under the same
`economicSourceKey` is classified as `ECONOMIC_SOURCE_EVENT_MISMATCH` before any new
operation and can never create an independent receivable merely because its derived
idempotency key differs.

For all three contracts, section 5 and 22.1 byte rules apply. PR9a fixtures publish
the exact UTF-8 canonical JSON and lowercase SHA-256 for baseline, every single-field
mutation, array permutation, duplicate/empty-array rejection, null boundary end and
Unicode/escaping cases. Cross-implementation fixtures must match byte-for-byte.

## 23. Exact transaction algorithms

Before either primary transaction the repository may perform only bounded deeply
inert validation, copy selector/assertion strings, compute `commandFingerprint`, and
pre-generate candidate UUIDs for rows that might be inserted. It makes no authority,
source, acceptance, time-window, replay, conflict or write decision. No caller
object, proxy, accessor, callback, policy function, hook, caller clock or ID
generator is reachable after `BEGIN IMMEDIATE`; statements receive only
repository-owned inert primitives. The sole permitted post-lock capability call is
the repository clock call defined next.

For every algorithm below, immediately after successful `BEGIN IMMEDIATE` the
repository calls `repositoryClock.readUtcMilliseconds()` exactly once. It must
return a safe integer Unix epoch millisecond in inclusive range `0` through
`253402300799999`; the repository deterministically renders that value as exact
RFC3339 UTC milliseconds and stores it as `attemptedAt`. Throw, missing value,
non-integer, unsafe integer, out-of-range value or conversion failure rolls back.
Immediately after the return, the clock capability is discarded and cannot be
invoked again in the transaction. `attemptedAt` is the only time
input for every decision and every newly persisted timestamp in that transaction.
Specifically it evaluates authority `effectiveFrom`/`expiresAt`, credential expiry,
revocation/supersession state, activation interval, PR8 evidence and event freshness,
replay/conflict classification, and supplies new event/conflict/`postedAt`/operation/
audit/`createdAt` values.

The exact monotonic floor is the maximum valid timestamp from these columns in the
same company/branch:

```text
actual_receivable_eligible_events.createdAt
canonical_receivable_posting_operations.createdAt
canonical_receivables.postedAt
canonical_receivables.createdAt
financial_audit_events.createdAt
canonical_receivable_posting_conflicts.createdAt
```

The exact logical query is:

```sql
SELECT MAX(operationalTimestamp) AS monotonicFloor
FROM (
  SELECT createdAt AS operationalTimestamp
  FROM actual_receivable_eligible_events
  WHERE companyId = :companyId AND branchId = :branchId
  UNION ALL
  SELECT createdAt
  FROM canonical_receivable_posting_operations
  WHERE companyId = :companyId AND branchId = :branchId
  UNION ALL
  SELECT postedAt
  FROM canonical_receivables
  WHERE companyId = :companyId AND branchId = :branchId
    AND sourceSystem = 'rentcore.billing_source_authority.v1'
  UNION ALL
  SELECT createdAt
  FROM canonical_receivables
  WHERE companyId = :companyId AND branchId = :branchId
    AND sourceSystem = 'rentcore.billing_source_authority.v1'
  UNION ALL
  SELECT createdAt
  FROM financial_audit_events
  WHERE companyId = :companyId AND branchId = :branchId
    AND eventType = 'canonical_receivable.initial_posted.v1'
  UNION ALL
  SELECT createdAt
  FROM canonical_receivable_posting_conflicts
  WHERE companyId = :companyId AND branchId = :branchId
);
```

Canonical rows are included only when `sourceSystem =
rentcore.billing_source_authority.v1`; audit rows only when `eventType =
canonical_receivable.initial_posted.v1`. Operation `createdAt` is its persisted
`attemptedAt`; conflict `createdAt = detectedAt = attemptedAt`; event
`createdAt = occurredAt = attemptedAt`; canonical `createdAt = postedAt = updatedAt`;
and audit `createdAt = occurredAt`, so the equal aliases are not queried twice.
The floor query is one repository-owned `MAX` over the six exact columns after
scope filters. Null floor means no prior operational timestamp. Every returned
timestamp is parsed and range-validated; read/parse ambiguity rolls back.

`attemptedAt >= floor` is allowed, so the same millisecond is valid; any
`attemptedAt < floor` is clock regression and rolls back. Clock skew tolerance is
exactly zero. Authority/authorization/activation `effectiveFrom`, `expiresAt`, any
activation start/end, `boundaryEndUtc`, due date, source business timestamp,
`conductedAt`, `signedAt`, `importedAt`, future validity endpoint and non-PR9 row are
explicitly excluded from the floor. Thus an active record with future expiry cannot
cause false regression. No repeated clock read or caller time is allowed. Exact
replay returns only original persisted timestamps and never exposes `attemptedAt` as
a new result timestamp.

### Algorithm A — PR9a eligibility-event production

Inside one repository-owned `BEGIN IMMEDIATE`:

1. capture and validate the single `attemptedAt` as above;
2. reread the write-authorization record and its latest chain, the activation and
   boundary/cohort, and the exact accepted `[{dryRunId,resultHash}]` pair set;
3. reread the PR5 company record, require one available valid IANA timezone, compare
   it to the activation timezone/boundary derivation and freeze it as
   `companyTimezoneSnapshot`; null, invalid, unavailable or ambiguous authority
   denies before event insertion;
4. reread the PR8 run/result, candidate, input set, operations, audit, seals,
   reconciliation and counts and require every term of
   `AcceptedPr8EvidencePredicateV1`: run `completed`, candidate
   `eligible_candidate`, complete seal, `diagnosticOnly = true`,
   `canonicalWriteAuthorized = false`, `productionActivationAuthorized = false`,
   zero blockers, zero unexplained net/VAT/gross deltas, exact accepted
   policy/ownership/source hashes, exact accepted pair and freshness under
   `attemptedAt`;
5. reread the complete current 16-table PR6 set defined in section 22.4, including competing
   versions, successors, overlaps, reopen/cancel/correct/supersession state,
   ownership manifests, upstream IDs and every row class;
6. reread the latest source-adapter and eligibility-producer authority chains and
   the posting authority referenced by the write authorization; compare source
   adapter ID/version/hash, scope, operation, source systems, complete row-class
   allowlist, owner, upstream IDs, artifact, commit, configuration, policy,
   effective interval, expiry and lifecycle;
7. reconstruct the accepted PR8 due-date policy ID/version/hash, `cohortHash`,
   `boundaryHash`, `acceptedDryRunsHash`, `sourceLineageHash` and
   `economicSourceKey`; require exact authorization/activation agreement, then query
   `(companyId,economicSourceKey)` and exact `(dryRunId,candidateId)` before insert;
8. construct the complete event projection including `companyTimezoneSnapshot` and
   due-date policy triple and compute `eventHash`: use the existing row's
   persisted `occurredAt`/`createdAt`/`correlationId` when an economic key exists;
   otherwise use the single `attemptedAt` and pre-generated repository correlation;
   also query `(companyId,eventHash)`. If one persisted event
   matches every field/hash, reread its bound PR8/PR6/authority/authorization/
   activation rows, commit with zero writes and return that event's persisted
   timestamps with `replayed=true`;
9. if the economic/candidate identity exists with different content, including
   timezone or due-policy drift, or any identity points to different scope/content,
   construct the exact registered `ConflictObservationV1`, roll back with zero
   event/canonical/audit/operation writes, and pass only its branded inert denial
   descriptor to algorithm C;
10. otherwise construct and insert exactly one `ActualReceivableEligibleV1` using a
   pre-generated repository UUID and `occurredAt = createdAt = attemptedAt`;
11. reread the event plus PR5 timezone and every referenced PR8, PR6,
    source/producer authority,
    authorization, activation and boundary row; recompute every exact field, pair,
    fingerprint and hash from persisted state, and require exactly one event for the
    economic key and exactly one for the run/candidate pair;
12. commit only on byte-exact equality and return the persisted row. Any insert,
    trigger, reread or reconstruction failure rolls back to zero writes.

Algorithm A never reads PR7 forecast, never writes canonical, settlement, legacy or
`app_data` data, and cannot create an event from an unaccepted pair. Its exact replay
is a no-op only after current predicate/timezone/authority validation; a due-date,
amount, due-policy ID/version/hash, timezone or authority change retains the same
economic key and becomes conflict rather than a second event. With no prior event,
missing/invalid/unavailable PR5 timezone produces no row; with a prior event it is
`COMPANY_TIMEZONE_DRIFT` and exact replay is forbidden until the authority matches.

### Algorithm B — PR9b canonical posting

Inside a separate repository-owned `BEGIN IMMEDIATE`:

1. capture and validate the single `attemptedAt` as above;
2. reread the event by exact ID/company/branch and recompute its `economicSourceKey`,
   `eventHash` and `sourceLineageHash`;
3. reread fresh PR5 company authority, require one valid IANA timezone and compare it
   byte-exactly with `event.companyTimezoneSnapshot`; null, invalid, unavailable or
   changed timezone is `COMPANY_TIMEZONE_DRIFT` before replay or DML;
4. repeat the exact `AcceptedPr8EvidencePredicateV1` evaluation—including
   `diagnosticOnly = true`, both write flags false, zero blockers/deltas, exact
   accepted hashes/pair and freshness—and the full current PR6 16-table
   lifecycle/ownership/upstream-row reread from Algorithm A; no event-time decision
   is trusted;
5. reread latest source, producer and posting authority chains, the exact write
   authorization and its primary-effect/denial permissions, activation and boundary;
   validate scope, hashes, source row classes, artifacts, policies, effective
   intervals, accepted pairs, due-date policy ID/version/hash, cohort/boundary
   envelopes and current lifecycle using `attemptedAt`;
6. reconstruct the mapping using only `event.companyTimezoneSnapshot`, derive
   `CanonicalPostingIdempotencyKeyV1`, recompute command fingerprint and prospective
   canonical row; query event, economic source, idempotency, canonical external ID,
   operation and audit identities before DML;
7. if a prior operation, canonical row and audit row all exist and every persisted
   field plus canonical/audit/operation/result fingerprint is exact, commit with zero
   writes and return the original IDs/timestamps with `replayed=true`;
8. on missing companion rows, changed content, source/policy/timezone/authority drift
   or any non-exact identity collision, construct the exact registered
   `ConflictObservationV1`, roll back all primary effects, then invoke Algorithm C
   with its branded inert denial descriptor;
9. otherwise insert one direct-`posted` canonical receivable with a pre-generated
   repository ID and `postedAt = createdAt = updatedAt = attemptedAt`;
10. compute the fingerprint of the persisted canonical projection, then insert one
   operation seal using pre-generated operation/audit IDs, exact source-adapter and
    accepted-pair/due-policy bindings, `createdAt = attemptedAt`, and the prospective
    audit and result fingerprints;
11. insert one repository-derived audit event with `occurredAt = createdAt =
    attemptedAt`; the audit-side scope/binding trigger must accept it;
12. reread the canonical, operation and audit rows and every event, PR5, PR8, PR6,
    authority, authorization, activation and boundary reference; recompute
    `canonicalReceivableFingerprint`, `auditPayloadFingerprint`,
    `auditEventFingerprint` and `resultHash` from persisted state;
13. commit only on byte-exact equality. Audit insert/trigger failure, missing or
    extra rows, ignored DML, fingerprint mismatch or reread failure rolls back the
    receivable, operation and audit together.

### Algorithm C — denied-attempt conflict evidence

Algorithm C runs only after A or B has rolled back and cannot share their
transaction. It receives a frozen repository-derived denial descriptor, never a
caller-selected table/type/projection/fingerprint. In a new repository-owned `BEGIN IMMEDIATE`
it captures its own single `attemptedAt`, rereads the exact write-authorization
record and `denialEvidenceTable`/`denialEvidencePermission`, and rereads the bound
source/posting authority, activation, scope and immutable denial identities/hashes.
The permission is evidence-only: it may remain inspectable when the primary status
caused the denial, but cannot authorize any primary-effect table or success path.

The repository validates the unexported descriptor brand, reconstructs the exact
registered expected and observed projections from persisted state, recomputes
`expectedFingerprint`, `observedFingerprint`, `conflictObservationJson`,
`conflictObservationHash` and `conflictHash`, returns an exact existing conflict as a
no-op, or inserts exactly one conflict with pre-generated ID and `detectedAt =
createdAt = attemptedAt`; it then rereads and recomputes the persisted row before
commit. No canonical, event, operation, audit, settlement, PR6/PR8, legacy or
`app_data` write is permitted. Missing/ambiguous permission, scope/hash mismatch,
dedupe anomaly, rate/circuit breach or persistence failure rolls back, opens the P0
telemetry circuit and still never permits the denied primary effect.

For all three algorithms, `SQLITE_BUSY` and `SQLITE_LOCKED` are caught at begin,
statement, reread and commit boundaries and mapped to the stable repository error
`CANONICAL_POSTING_CONCURRENT_CONFLICT`; raw SQLite errors never escape and automatic
retry count is zero. Concurrent processes yield one committed winner plus an exact
replay or deterministic conflict, never duplicates or partial rows.

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
- exact composite source-adapter parent/FKs and audit `(id,companyId,branchId)` FK;
- audit-side trigger rejects wrong scope, correlation, aggregate, actor, authority,
  event type/identity, payload or fingerprint and accepts only the exact operation;
- wrong `eventType` cannot bypass the audit trigger; one audit ID referenced by
  multiple incompatible operations is rejected by uniqueness and trigger checks;
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
- exact UTF-8 byte fixtures and SHA-256 outputs cover every section 22 envelope,
  null versus omission, escaping, array order, duplicate pair rejection and safe
  integer boundaries;
- cohort logical-array permutations normalize identically; duplicates reject;
  boundary start/end/timezone mutations and every idempotency member mutate their
  exact hashes; stored JSON text is never hashed in place of logical arrays;
- every `ConflictObservationV1` projection has cross-implementation canonical-byte
  and SHA-256 fixtures, null-rule tests and one-field mutation tests;
- gross basis and due-date rules match the approved policy exactly.

### Authority and activation

- contiguous immutable version chains; missing/duplicate/ambiguous versions deny;
- expired/revoked/superseded/not-yet-effective states deny;
- human/admin/system impersonation denies;
- artifact, commit, config, policy, environment, scope, operation and cohort drift
  deny after lock;
- source-adapter ID/version/hash mismatch, non-latest record, wrong source system,
  incomplete row-class allowlist, ownership/upstream ID drift and cross-scope
  substitution deny in authorization, event, operation and conflict paths;
- accepted dry-run pair permutation canonicalizes identically, while duplicate IDs,
  unpaired IDs/hashes and a changed result hash deny under lock;
- catalog remains exact v1/11 and PR5–PR8 assertions continue passing.

### Eligibility event

- only an accepted, sealed, current, blocker-free PR8 candidate can emit;
- fixture/unaccepted/stale/unsealed/blocked candidate denies;
- the exact PR8 predicate accepts `diagnosticOnly=true`; it rejects
  `diagnosticOnly=false`, `canonicalWriteAuthorized=true`,
  `productionActivationAuthorized=true`, any blocker, incomplete seal, any non-zero
  unexplained net/VAT/gross delta, hash/pair mismatch or stale evidence;
- every PR6 row/version/hash and zero-delta reconciliation is current;
- PR7/app_data fallback is structurally absent;
- economic identity is stable across policy/due/amount changes; exact replay creates
  no second event and changed source/policy/due/amount creates one conflict;
- missing/mixed/mutated due-date policy ID/version/hash rejects; changing version or
  hash under the same economic key produces `DUE_DATE_POLICY_DRIFT` and never a
  second event;
- PR5 timezone null/invalid/unavailable rejects event creation; the valid locked
  timezone is stored as `companyTimezoneSnapshot` and covered by `eventHash`;
- algorithm A rereads all PR8/PR6/source/producer/authorization/activation rows after
  `BEGIN IMMEDIATE`, uses one clock value and rereads the inserted event before commit;
- event clock throw/invalid/out-of-range/regression rolls back; replay returns only
  persisted timestamps;
- event production performs no canonical/settlement/legacy write.

### Posting

- event-to-PR1 mapping is exact; workflow is direct `posted` only;
- repository owns actor, row, timestamps, IDs, hashes and audit;
- algorithm B repeats every PR8/PR6/authority decision after lock and executes no
  callback/getter/hook/clock/ID generator after the single `attemptedAt` read;
- source reopen/cancel/correct/supersession and overlapping coverage deny;
- Algorithm B applies the identical exact PR8 predicate used by Algorithm A;
- timezone change between A and B is `COMPANY_TIMEZONE_DRIFT`; even an otherwise
  exact replay is denied, and canonical mapping never substitutes the new timezone;
- exact replay writes nothing; changed replay writes zero canonical rows and records
  only the approved conflict evidence;
- revocation/expiry between planning and lock denies;
- forced failure at receivable, audit, operation and reread stages rolls back all;
- wrong audit company/branch/correlation/aggregate/actor/event/payload and deliberate
  audit-fingerprint mismatch each roll back canonical and operation rows;
- wrong audit event type is tested specifically against trigger activation by
  referenced audit ID, not merely caught by repository reread;
- primary-effect authorization cannot write the conflict table; denial permission
  cannot write any primary-effect table; algorithm C performs no business write;
- conflict evidence permission/scope/hash failure opens the circuit while leaving
  the denied primary effect at zero rows; repeat conflict deduplicates;
- every registered conflict type reconstructs its exact expected/observed
  projections; caller-selected type/projection/hash rejects, same observation
  deduplicates and any semantic projection mutation produces a new immutable hash;
- posting/conflict clock throw/invalid/out-of-range/regression rolls back and exact
  posting replay returns original persisted timestamps;
- persisted-row mutation/ignore/extra-row fault injection is detected;
- full PR9 canonical immutability and no-delete triggers are enforced.

### Concurrency and operations

- independent processes produce one winner plus exact replay/conflict;
- no raw busy/locked errors, duplicates, orphan operations or missing audit;
- busy/locked injection at begin, each DML, reread and commit maps to
  `CANONICAL_POSTING_CONCURRENT_CONFLICT` with zero automatic retries;
- concurrent algorithm-A producers yield one event; concurrent algorithm-B posters
  yield one canonical/operation/audit set; conflict writers yield one hash row;
- future authorization/activation expiry is excluded from the clock floor; a lower
  prior operational timestamp permits progress, same-millisecond equality succeeds,
  and a value below the exact operational floor rejects;
- clock throw, missing/non-integer/unsafe/out-of-range return and attempted second
  `repositoryClock.readUtcMilliseconds()` invocation each fail closed; replay returns
  only persisted timestamps;
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

### Mandatory P1 remediation regressions

- exact `AcceptedPr8EvidencePredicateV1` truth-table and byte-identical use by
  D-PR9-08, Algorithms A/B and the field matrix;
- due-date policy ID/version/hash absence, mix-and-match and mutation regressions;
- timezone snapshot creation, invalid/unavailable authority, A-to-B drift and replay
  after drift;
- audit trigger bypass attempt with wrong event type and incompatible shared audit ID;
- all twelve `ConflictObservationV1` projection, dedupe, PII/secret rejection and
  cross-implementation fixture cases;
- future validity endpoints excluded from the monotonic floor, operational
  regression/equality policy and exactly-one repository clock call;
- cohort ordering/duplicate rejection, boundary normalization/null-end rules and
  idempotency baseline plus every-field mutation fixtures;
- revoked source adapter and latest-chain source-adapter supersession deny after
  lock; ownership-manifest/upstream-row-class mismatch denies;
- concurrent event creation for one `economicSourceKey` commits exactly one event;
- the same economic key with changed due date and with changed amount policy each
  produces deterministic conflict and never a second event;
- dry-run ID/result mix-and-match, duplicate ID/pair and changed accepted pair deny;
- omission or one-field mutation is exercised for every literal field in each
  section 22 envelope, with immutable cross-implementation canonical byte/hash
  fixtures;
- audit wrong company, branch, aggregate, actor identity, actor authority, payload,
  correlation or event type; missing audit; duplicate audit; and attempted audit
  update after operation all fail without a committed canonical effect;
- clock exactly at authority/activation/evidence expiry boundary denies; clock
  throw, invalid value, range failure and regression deny without writes;
- unauthorized conflict append, caller-selected conflict operation/table, conflict
  persistence failure, deduplication and rate/circuit limits are fault-injected;
- conflict persistence failure returns
  `CANONICAL_CONFLICT_EVIDENCE_PERSISTENCE_FAILED`, opens the circuit and cannot
  convert the original denial into success.

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
| `architectureDesignApproved` | `FALSE` | Gate A requires durable Product/Business Owner and independent Technical Architecture Reviewer approvals bound to the same exact PR head |
| `pr9aImplementationAuthorized` | `FALSE` | Gate B exact-scope/base-SHA owner authorization is absent |
| `pr9bImplementationAuthorized` | `FALSE` | Gate C is open and no exact PR9b authorization exists |
| `pr9ImplementationAuthorized` | `FALSE` | legacy aggregate remains fail-closed and cannot substitute for the scoped PR9a/PR9b gates |
| `productionEvidenceAccepted` | `FALSE` | blocked: no accepted current PR8 production evidence pack |
| `productionIdentityReady` | `FALSE` | blocked: PR5 business/bootstrap rows remain zero |
| `productionSourceAuthorityReady` | `FALSE` | blocked: PR6 business rows and approved adapter instance absent |
| `productionDryRunExecutionAuthorized` | `FALSE` | no separate execution authorization |
| `productionDryRunExecutionCompleted` | `FALSE` | PR8 production rows remain zero |
| `productionDryRunEvidenceAccepted` | `FALSE` | blocked: no production run/evidence acceptance |
| `sourceAdapterAuthorityApproved` | `FALSE` | blocked: design only; no concrete production authority |
| `eligibilityProducerAuthorityApproved` | `FALSE` | blocked: design identity only |
| `canonicalPostingAdapterAuthorityApproved` | `FALSE` | blocked: design identity only |
| `operationalControlsApproved` | `FALSE` | Gate C production limits, monitoring, rollback and incident controls are not approved or enforced |
| `retentionAndLegalHoldControlsApproved` | `FALSE` | Gate C legal/privacy and operations approval is absent |
| `canonicalWriteContractApproved` | `FALSE` | Gate A design approval cannot approve a production write contract |
| `foundationDeploymentRetryAuthorized` | `FALSE` | separate foundation retry remains unauthorized |
| `pr9DisabledDeploymentAuthorized` | `FALSE` | separate decision absent |
| `productionActivationAuthorized` | `FALSE` | single-use Gate D authorization absent |
| `canonicalProductionReadsAuthorized` | `FALSE` | resolver null; flag default false; no approval |
| `productionCanonicalWritesAuthorized` | `FALSE` | no Gate C closure or single-use Gate D authorization |
| `settlementAuthorized` | `FALSE` | PR10 not authorized |
| `shadowReadAuthorized` | `FALSE` | PR11 not authorized |
| `cutoverAuthorized` | `FALSE` | PR12 not authorized |

If both valid Gate A approvals are later recorded, only
`architectureDesignApproved` may become `TRUE`. Every other field in this table
remains unchanged. A later Gate B owner prompt may change only
`pr9aImplementationAuthorized`; it cannot change any deployment or production field.

## 27. D-PR9 status matrix

| Decision | Gate A design disposition | Deferred production decision |
|---|---|---|
| D-PR9-01 Amount basis | gross RUB minor-unit representation; no recalculation | Gate C Accounting/Finance and Tax/VAT revalidate production amount and VAT policy |
| D-PR9-02 Due date | nullable model and explicit provenance contract | Gate C Accounting/Finance and Legal/Privacy revalidate production due-date semantics |
| D-PR9-03 Conducted/signature/evidence | fail-closed evidence-chain structure | Gate C Accounting/Finance, Legal/Privacy and source authority revalidate admissibility |
| D-PR9-04 Source systems/adapters | stable logical source and allow-listed adapter contract | Gate C approves the concrete production source/adapter authority |
| D-PR9-05 Integration identity | named same-process identity contract | Gate C approves concrete production identity and credential/authority controls |
| D-PR9-06 Capability catalog | strategy A; keep human catalog v1/11 | any future catalog or external identity change requires a new design review |
| D-PR9-07 Boundary/cohort | single-company/branch forward-only cohort shape | Gate C revalidates production cohort policy; Gate D alone activates it |
| D-PR9-08 PR8 evidence | sealed-evidence admission contract shape only | Gate C independently reviews and accepts an actual production evidence pack |
| D-PR9-09 DB objects | additive six-table/index/trigger design | Gate B separately controls PR9a initializer implementation; Gate D controls production migration |
| D-PR9-10 Mapping | exact event-to-PR1 projection design | production policy inputs remain subject to their Gate C approvals |
| D-PR9-11 Immutability | source-scoped no-update/no-delete design | future correction/compensation needs a separate design and authorization |
| D-PR9-12 Conflict evidence | rollback plus deduplicated append-only conflict design | production privacy/security/operations controls remain Gate C |
| D-PR9-13 Post-posting changes | detect, deny and quarantine design | any production correction/compensation policy is outside PR9 |
| D-PR9-14 Thresholds | local/disabled validation defaults | Gate C Security/Operations revalidates enforceable production values |
| D-PR9-15 Retention/incidents | retention/security design assumptions | Gate C Legal/Privacy and Security/Operations revalidate production controls |
| D-PR9-16 PR structure | stacked PR9a foundation then PR9b posting | Gate B may authorize PR9a only; PR9b waits for Gate C; any release waits for Gate D |

All D-PR9-01–16 may be approved now only as Gate A architecture design assumptions.
This document itself approves none of them. In particular, Gate A does not accept
actual PR8 production evidence and does not finalize production policy values for
D-PR9-01, D-PR9-02, D-PR9-03, D-PR9-07, D-PR9-08, D-PR9-14 or D-PR9-15.

## 28. Gate A Owner Approval Packet

Gate A requires two durable approvals bound to the same exact PR #231 head: one
from the Product/Business Owner and one from an independent Technical Architecture
Reviewer. It does not require separate Accounting, Tax/VAT, Legal/Privacy, Security
or Operations approvers. Those specialists are required only at Gate C for the
production policy/evidence contracts within their competence. Formal legal or tax
opinions are not prerequisites for the local disabled foundation, because Gate A
and Gate B assert no production legal/tax correctness and permit no production data
or financial recognition.

The Technical Architecture Reviewer must submit this exact statement after
replacing `<EXACT_PR_HEAD_SHA>` with the full current head SHA:

```text
TECHNICAL ARCHITECTURE REVIEW APPROVED — I independently reviewed PRE-PR9 Design Closure in PR #231 at exact head <EXACT_PR_HEAD_SHA>. I approve D-PR9-01–D-PR9-16 only as the Gate A architecture design assumptions and fail-closed PR9a/PR9b boundaries recorded in that head. I do not approve implementation, deployment, production migration, Railway access, production reads or writes, accounting/tax/legal/privacy production policy, production evidence, activation, settlement, shadow read or cutover.
```

Automated review output may be linked as evidence for that reviewer, but cannot be
the authenticated durable approval itself. The reviewer approval is invalid if the
document head changes afterward.

After that technical approval exists for the same head, the Product/Business Owner
may submit the following exact statement, replacing `<EXACT_PR_HEAD_SHA>` with the
full current head SHA:

```text
OWNER DESIGN APPROVAL — I confirm that I am the Product/Business Owner authorized for rentCore. I approve Gate A architecture design in PR #231 at exact head <EXACT_PR_HEAD_SHA>, including D-PR9-01–D-PR9-16 only as design assumptions for the contracts, schema design, transaction design, isolation, test matrix and PR9a/PR9b split recorded in that head. I confirm that a durable independent Technical Architecture Reviewer approval exists for the same exact head. I acknowledge that Accounting/Finance, Tax/VAT, Legal/Privacy, production evidence, source/identity authority, Security/Operations readiness and all production policy values remain unapproved until their applicable later gates. This approval authorizes no merge automatically, no PR9a or PR9b implementation, no disabled or production deployment, no production migration, no Railway access, no production PR8 execution, no canonical production read or write, no settlement, no shadow read and no cutover.

architectureDesignApproved = TRUE
pr9aImplementationAuthorized = FALSE
pr9bImplementationAuthorized = FALSE
pr9ImplementationAuthorized = FALSE
pr9DisabledDeploymentAuthorized = FALSE
foundationDeploymentRetryAuthorized = FALSE
productionActivationAuthorized = FALSE
canonicalProductionReadsAuthorized = FALSE
productionCanonicalWritesAuthorized = FALSE
settlementAuthorized = FALSE
shadowReadAuthorized = FALSE
cutoverAuthorized = FALSE
```

The statements are valid only when their authenticated author identity, UTC
timestamp, permanent reference and literal text are durable and both identify the
same unchanged PR head. The owner approval may set only
`architectureDesignApproved = TRUE`. PR9a remains forbidden until a new Gate B
owner prompt names its exact implementation scope and base SHA. PR9b remains
forbidden until Gate C closes and a separate exact authorization is recorded.

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
