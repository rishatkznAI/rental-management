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
- identifiers are non-empty opaque strings, 1–160 UTF-8 bytes after validation;
  they must be valid Unicode scalar sequences, reject lone UTF-16 surrogates and
  invalid UTF-8, and receive no implicit Unicode normalization;
- hashes are lowercase 64-character SHA-256 hex;
- timestamps are repository-owned RFC3339 UTC with millisecond precision;
- civil dates are exact valid `YYYY-MM-DD` dates in the PR5 company IANA timezone;
- money is RUB safe-integer kopecks in `[0, 9007199254740991]`;
- authoritative objects are deeply inert plain JSON: no proxies, accessors,
  symbols, custom prototypes, `toJSON`, cycles, sparse arrays, bigint, undefined,
  non-finite/floating numbers or secret-bearing keys;
- canonical JSON is the restricted RFC 8785/JCS contract in section 22.1: object
  property names sort by unescaped UTF-16 code units, arrays preserve only their
  contract-defined order, strings use the exact JCS escaping rules, no Unicode
  normalization occurs, and the result is encoded as UTF-8 without BOM;
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

**Recommended decision:** `dueDateProvenance=unknown` may be eligible only when the
approved PR8 `unknown_due_date_treatment` gate has the exact immutable source
decision literal `allow_unknown_without_aging`. PR9 never rewrites that PR8 literal.
The repository-owned versioned `UnknownDueDatePostingTreatmentMappingV1` maps it to
the distinct PR9 canonical treatment `post_without_aging_v1`, with
`contractualDueDate = NULL`, `dueDateEvidenceRef = NULL` and
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

The two PR8 due-date authorities are independent named members of
`DueDatePolicySetV1`:

```text
contractualDueDate = {
  gateKind: contractual_due_date,
  expectedSourceRef: expectedSourceRef,
  policyId: decisionRef,
  policyVersion: decisionVersion,
  policyHash: decisionHash
}
unknownDueDateTreatment = {
  gateKind: unknown_due_date_treatment,
  decisionLiteral: allow_unknown_without_aging,
  policyId: decisionRef,
  policyVersion: decisionVersion,
  policyHash: decisionHash,
  mappingId: rentcore.unknown_due_date_posting_treatment.v1,
  mappingVersion: 1,
  mappingHash: UnknownDueDatePostingTreatmentMappingV1
}
```

Authorization and activation persist canonical `dueDatePolicySetJson` plus
`dueDatePolicySetHash`; the set contains both named members and the exact mapping.
For a proven date the event selects only `contractual_due_date`, requires a date and
evidence ref, requires the gate's exact `expectedSourceRef` to equal the event
`dueDateProvenance`, and stores that selected decision ID/version/hash; every unknown
mapping field is JSON/SQL null. The unknown gate cannot authorize a proven date. For
`unknown`, the event selects only `unknown_due_date_treatment`, requires the exact
source literal and mapping ID/version/hash above, and keeps date/evidence null. The
contractual gate cannot authorize an unknown date.

The event therefore persists `selectedDueDateGateKind`,
`selectedDueDatePolicyId`, `selectedDueDatePolicyVersion`,
`selectedDueDatePolicyHash`, `dueDateTreatment`, and nullable
`unknownDueDateTreatmentMappingId`/`Version`/`Hash`. Those fields and the policy-set
hash participate in the event, command, audit, operation, result and conflict
envelopes, but are expressly excluded from the policy-independent
`economicLineageKey`. Authorization, activation, Algorithms A/B/C and persisted
reread use the same canonical PR8 manifest and reject missing, ambiguous, unknown,
cross-gate or mixed ID/version/hash bindings. A due-date, selected-gate, source
literal or mapping change for the same economic source is a deterministic conflict,
never a second event. PR9 changes no PR8 evaluator or PR8 policy contract.

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

**Recommended same-process v1 actor identities:**

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

`actorId` is the stable integration identity and may be reused across scopes.
`authorityId` is instead a repository-derived scope-specific chain identity:

```text
authorityId = "authority-chain:" + sha256(canonicalJson({
  actorId, authorityKind, branchId, companyId,
  domain: rentcore.governed_adapter_authority.chain,
  version: 1
}))
```

One record cannot cross scope. The logical/latest-chain identity is exact
`(companyId,branchId,authorityKind,authorityId)` and its version key appends
`authorityVersion`. Thus one actor may have independent source, producer or posting
authority chains for multiple companies/branches without sharing a version chain.

Inside `BEGIN IMMEDIATE`, the repository rereads the latest authority version and
denies expired, revoked, superseded, ambiguous or artifact/config/policy-drifted
identity. Revocation after planning but before lock denies. Revocation after commit
blocks future attempts and preserves history.

Producer and posting authority are never ID-only references. Their exact downstream
binding is the six-field composite record ID, authority version, record hash,
company, branch and fixed authority kind. Write authorization seals both composites;
the event seals the producer composite; activation/operation/audit/result seal the
posting-adapter composite; conflict evidence seals both. A one-field difference or a
same-ID later version is deterministic drift/supersession, never silent acceptance.

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
`forwardOnlyStartUtc`, the civil `forwardOnlyStartDate`, and exact SQL/JSON null
`boundaryEndUtc`. V1 enforces `CHECK (boundaryEndUtc IS NULL)`; no bounded v1 cohort
exists. Lifecycle `effectiveFrom`/`expiresAt` never silently become source-boundary
identity. Any future end boundary requires a separately reviewed contract and
migration version, a new boundary hash version and a new activation record; it
cannot update or reinterpret a v1 record.

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
reconciliationRowSetComplete = true
every sealed reconciliation row has deltaNetMinor = 0
every sealed reconciliation row has deltaVatMinor = 0
every sealed reconciliation row has deltaGrossMinor = 0
policyManifestHash = acceptedPolicyManifestHash
sourceOwnershipManifestHash = acceptedSourceOwnershipManifestHash
sourceInputManifestHash = acceptedSourceInputManifestHash
{dryRunId,resultHash} is one exact accepted pair
run.companyTimezone = acceptedCompanyTimezoneSnapshot
acceptedCompanyTimezoneSnapshot = activation.companyTimezoneSnapshot
activation.companyTimezoneSnapshot = freshPr5ReceivablesTimezone
finalizedAt <= attemptedAt
attemptedAt < validUntilExclusive
validUntilExclusive = finalizedAt + acceptedEvidenceFreshnessDurationMs
acceptedEvidenceFreshnessDurationMs = 900000
freshnessPolicyId = rentcore.pr8_evidence_freshness.v1
freshnessPolicyVersion = 1
freshnessPolicyHash = FreshnessWindowPolicyV1
freshnessWindowFingerprint = FreshnessWindowFingerprintV1
```

The freshness interval is exact half-open `[finalizedAt, validUntilExclusive)` in
integer UTC milliseconds. `finalizedAt` must parse to a safe integer millisecond,
the duration is the exact positive integer `900000`, and addition must remain within
the section-23 UTC range. Invalid input, negative duration, overflow, a mismatched
persisted `validFrom`/`validUntilExclusive`, or equality with the exclusive upper
bound fails closed. No wall-clock or floating-point duration arithmetic is allowed.

`sealComplete` is repository-derived and true only when the complete run operation,
audit, input, candidate, check, reconciliation and diagnostic row graph exists and
all counts, relational links and hashes reproduce byte-exactly.

The exact reconciliation row set is all rows of
`actual_source_dry_run_reconciliations` for which `companyId = run.companyId`,
`branchId = run.branchId` and `runId = run.id`. Every row must reference by the
composite FK `(candidateId,runId,companyId,branchId)` exactly one candidate in that
same sealed run; PR8 v1 admits no null `candidateId` in this accepted set. Because a
`completed` PR8 v1 run has complete lineage for every candidate, the set must contain
exactly `run.reconciliationCount = run.candidateCount * 6` rows, and each candidate,
including the selected candidate, must have exactly one row for each exact
`dimensionKind`: `snapshot_equation`, `upd_line_equation`,
`coverage_slice_equation`, `upd_line_aggregate`,
`closed_period_snapshot_aggregate`, `coverage_set_delta`.

Rows are reconstructed and ordered by lowercase `reconciliationHash` ascending.
Duplicate row ID, duplicate hash, duplicate
`(candidateId,dimensionKind,canonical dimensionIdsJson)`, missing/extra row,
run/candidate/scope mismatch, noncanonical dimension JSON, count mismatch or a hash
not appearing exactly once in the sealed run result's ordered
`reconciliationHashes` array fails closed. For each row independently,
`deltaNetMinor`, `deltaVatMinor` and `deltaGrossMinor` must each equal integer zero and
`blockerState` must equal zero. No sum, aggregate, sign cancellation, tolerance or
netting across rows is evaluated: `+100` in one row and `-100` in another is two
independent failures. The selected run's reconstructed `resultHash`, including this
exact ordered reconciliation-hash set, must equal the hash in the accepted
`{dryRunId,resultHash}` pair. Algorithms A and B invoke this same predicate and row
selection byte-for-byte.

The independently signed acceptance record persists canonical
`acceptedPr8EvidenceJson`, containing a non-empty array ordered by `dryRunId` with
exact objects:

```text
{ companyTimezoneSnapshot, dryRunId, finalizedAt,
  freshnessDurationMs, freshnessPolicyHash, freshnessPolicyId,
  freshnessPolicyVersion, freshnessWindowFingerprint, policyManifestHash,
  reconciliationSetHash, resultHash, sourceInputManifestHash,
  sourceOwnershipManifestHash, validFrom, validUntilExclusive }
```

`validFrom` equals `finalizedAt`; `validUntilExclusive` is its checked integer-
millisecond sum with `freshnessDurationMs = 900000`.
`FreshnessWindowPolicyV1` has domain
`rentcore.canonical_actual_posting.pr8_freshness_policy`, version `1`, and exactly
`{domain,durationMs,intervalKind,policyId,policyVersion,version}` with
`intervalKind = half_open` and the literals above. `FreshnessWindowFingerprintV1`
has domain `rentcore.canonical_actual_posting.pr8_freshness_window`, version `1`,
and exactly `{domain,finalizedAt,freshnessDurationMs,freshnessPolicyHash,
freshnessPolicyId,freshnessPolicyVersion,validFrom,validUntilExclusive,version}`.
`freshnessPolicyHash = sha256(canonicalJson(FreshnessWindowPolicyV1))` and
`freshnessWindowFingerprint =
sha256(canonicalJson(FreshnessWindowFingerprintV1))`; neither name denotes raw JSON.
The acceptance entry and acceptance hash seal every member. `reconciliationSetHash`
is SHA-256 of the exact ordered reconciliation hashes above.
`acceptedFreshnessWindowsHash` uses domain
`rentcore.canonical_actual_posting.accepted_freshness_windows`, version `1`, and
exactly `{domain,windows,version}`, where `windows` is the accepted evidence
projection `[{dryRunId,freshnessWindowFingerprint}]` in the same unique dry-run
order. Authorization and activation persist this set hash; a selected event/result/
conflict uses the exact entry fingerprint for its `dryRunId`.
All accepted runs in one company/branch activation must have one byte-identical,
canonical IANA `companyTimezoneSnapshot`. The pair projection of this array must
equal `acceptedDryRunsJson`; no independently supplied pair or timezone is accepted.
`acceptedPr8EvidenceHash` seals this array, `acceptedDryRunsHash` and
`evidencePackHash`. The evidence pack also names environment, deployment/artifact,
DB identity, capture time, tool/query class, reviewer and exact SHA-256 pack hash.
PR8 `resultHash` alone is expressly insufficient to bind timezone. No post-result
manual exclusion or aggregate netting is allowed.

The exact persisted timezone sources are
`actual_source_dry_runs.companyTimezone`, each acceptance entry's
`companyTimezoneSnapshot` inside
`canonical_write_authorization_records.acceptedPr8EvidenceJson` plus that record's
`acceptedCompanyTimezoneSnapshot`,
`canonical_posting_activation_records.companyTimezoneSnapshot`,
`actual_receivable_eligible_events.companyTimezoneSnapshot`
after Algorithm A inserts it, and fresh
`canonical_companies.receivablesTimezone`. The authorization and activation record
hashes bind their listed fields; the acceptance hash binds every entry. Algorithm A
requires run, acceptance, activation and fresh PR5 equality before it
copies the accepted PR8 value into the event. Algorithm B requires the resulting
event field to join that same equality. No unstored tool output or inferred timezone
can participate.

`CanonicalIanaTimezoneV1` validates but never rewrites a timezone. The exact input is
the persisted string. It must pass the authorized Node/ICU IANA parser and must equal
byte-for-byte
`new Intl.DateTimeFormat('en-US',{timeZone:value}).resolvedOptions().timeZone` in the
approved artifact. A parser throw,
different resolved canonical name, missing tzdb/ICU capability or non-scalar string
rejects; aliases are not replaced with the resolved value. The artifact/configuration
authority hash binds the Node, ICU and tzdb data identity used by this check. Every
Algorithm A comparison occurs only after its five pre-insert persisted values pass
this validation. Algorithm B repeats those five and the persisted event snapshot, so
all six applicable values pass before replay or DML.

Fixtures, tests, local SQLite, manually built JSON and this document are never
production evidence. In particular, `diagnosticOnly = true` is required and does not
become false; both write flags are required to remain false. Acceptance authorizes
only event eligibility under its exact scope; it does not reinterpret PR8 as a write
authorization and does not authorize canonical posting.

Accepted evidence is represented only as the ordered set
`acceptedDryRuns=[{dryRunId,resultHash}]`. It is sorted lexicographically by
`dryRunId` using the section-22.1 JCS string comparator, rejects duplicate IDs
(therefore also duplicate pairs), requires one
exact result hash per ID, and is
sealed as `acceptedDryRunsHash`; parallel identifier/hash arrays are forbidden. That
pair set is the exact projection of `acceptedPr8EvidenceJson` and cannot be validated
separately from `acceptedPr8EvidenceHash` or its accepted timezone,
freshness-window and manifest bindings.

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
authorityKind TEXT NOT NULL
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
sourceOwnershipManifestHash TEXT NOT NULL
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

Enums: authority kind is `source_adapter`, `eligibility_producer` or
`canonical_posting_adapter`; status is `authorized`, `revoked`, `expired` or
`superseded`; environment is `production`; allowed operation is exact for the kind.
Unique keys: `(companyId, branchId, authorityKind, authorityId,
authorityVersion)` and `recordHash`. The relational source parent key
`(recordId,authorityVersion,recordHash,companyId,branchId)` and the full authority
parent key `(companyId,branchId,authorityKind,recordId,authorityVersion,recordHash)`
are unique so every
consumer binds one exact scoped authority version without trusting caller JSON.
Composite FKs: `(companyId, branchId)` to canonical branches; predecessor binding
`(previousRecordId,companyId,branchId,authorityKind,authorityId)` to the exact prior
same-scope/same-kind chain row. Checks enforce the repository-derived scope-specific
authority ID, version sequence, artifact/configuration/policy/ownership hashes,
concrete branch, JSON arrays, time order and credential nullability. Every authority
kind binds the same complete PR6 `sourceOwnershipManifestHash` accepted for its
scope; a producer or posting adapter cannot operate over an ownership universe
different from the source adapter. A record and chain can cover exactly one company/branch;
cross-scope predecessor or consumer references abort.

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
producerAuthorityVersion INTEGER NOT NULL
producerAuthorityRecordHash TEXT NOT NULL
producerAuthorityCompanyId TEXT NOT NULL
producerAuthorityBranchId TEXT NOT NULL
producerAuthorityKind TEXT NOT NULL
postingAdapterAuthorityRecordId TEXT NOT NULL
postingAdapterAuthorityVersion INTEGER NOT NULL
postingAdapterAuthorityRecordHash TEXT NOT NULL
postingAdapterAuthorityCompanyId TEXT NOT NULL
postingAdapterAuthorityBranchId TEXT NOT NULL
postingAdapterAuthorityKind TEXT NOT NULL
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
acceptedPr8EvidenceJson TEXT NOT NULL
acceptedPr8EvidenceHash TEXT NOT NULL
acceptedCompanyTimezoneSnapshot TEXT NOT NULL
acceptedFreshnessWindowsHash TEXT NOT NULL
amountBasisPolicyRef TEXT NOT NULL
amountBasisPolicyHash TEXT NOT NULL
dueDatePolicySetJson TEXT NOT NULL
dueDatePolicySetHash TEXT NOT NULL
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
mandatory. For producer and posting bindings, the child company/branch columns must
equal the authorization scope, the kind columns must be exact literals
`eligibility_producer` and `canonical_posting_adapter`, and ID match without the
same version and record hash is insufficient.

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
acceptedPr8EvidenceHash TEXT NOT NULL
acceptedFreshnessWindowsHash TEXT NOT NULL
dueDatePolicySetJson TEXT NOT NULL
dueDatePolicySetHash TEXT NOT NULL
postingAdapterAuthorityRecordId TEXT NOT NULL
postingAdapterAuthorityVersion INTEGER NOT NULL
postingAdapterAuthorityRecordHash TEXT NOT NULL
postingAdapterAuthorityCompanyId TEXT NOT NULL
postingAdapterAuthorityBranchId TEXT NOT NULL
postingAdapterAuthorityKind TEXT NOT NULL
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
economicLineageKey TEXT NOT NULL
economicSourceRevisionKey TEXT NOT NULL
rootSourceDocumentLineageId TEXT NOT NULL
rootCoverageLineageId TEXT NOT NULL
currentPr6RevisionHash TEXT NOT NULL
eventSchemaVersion TEXT NOT NULL
eventVersion INTEGER NOT NULL
dryRunId TEXT NOT NULL
candidateId TEXT NOT NULL
candidateResultHash TEXT NOT NULL
completeInputSetHash TEXT NOT NULL
policyManifestHash TEXT NOT NULL
sourceOwnershipManifestHash TEXT NOT NULL
acceptedDryRunsHash TEXT NOT NULL
acceptedPr8EvidenceHash TEXT NOT NULL
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
dueDatePolicySetHash TEXT NOT NULL
selectedDueDateGateKind TEXT NOT NULL
selectedDueDatePolicyId TEXT NOT NULL
selectedDueDatePolicyVersion INTEGER NOT NULL
selectedDueDatePolicyHash TEXT NOT NULL
dueDateTreatment TEXT NOT NULL
unknownDueDateTreatmentMappingId TEXT NULL
unknownDueDateTreatmentMappingVersion INTEGER NULL
unknownDueDateTreatmentMappingHash TEXT NULL
sourceAdapterAuthorityRecordId TEXT NOT NULL
sourceAdapterAuthorityVersion INTEGER NOT NULL
sourceAdapterAuthorityRecordHash TEXT NOT NULL
producerAuthorityRecordId TEXT NOT NULL
producerAuthorityVersion INTEGER NOT NULL
producerAuthorityRecordHash TEXT NOT NULL
producerAuthorityCompanyId TEXT NOT NULL
producerAuthorityBranchId TEXT NOT NULL
producerAuthorityKind TEXT NOT NULL
writeAuthorizationRecordId TEXT NOT NULL
sourceLineageHash TEXT NOT NULL
correlationId TEXT NOT NULL
eventHash TEXT NOT NULL
schemaVersion INTEGER NOT NULL
occurredAt TEXT NOT NULL
createdAt TEXT NOT NULL
```

Unique keys: `(companyId, branchId, economicLineageKey)`,
`(companyId, branchId, economicSourceRevisionKey)`, `(companyId, eventHash)`, and
exact `(dryRunId, candidateId)`. Composite FKs connect candidate/run/scope,
activation, the exact producer authority ID/version/hash/scope/kind binding, write
authorization, PR6 activation boundary and exact PR6 lineage. Checks enforce
`ActualReceivableEligibleV1`, version 1, RUB, net+VAT=gross, original=gross,
half-open interval and due-date rules.

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
economicLineageKey TEXT NOT NULL
economicSourceRevisionKey TEXT NOT NULL
currentPr6RevisionHash TEXT NOT NULL
sourceAdapterAuthorityRecordId TEXT NOT NULL
sourceAdapterAuthorityVersion INTEGER NOT NULL
sourceAdapterAuthorityRecordHash TEXT NOT NULL
sourceOwnershipManifestHash TEXT NOT NULL
postingAdapterAuthorityRecordId TEXT NOT NULL
postingAdapterAuthorityVersion INTEGER NOT NULL
postingAdapterAuthorityRecordHash TEXT NOT NULL
postingAdapterAuthorityCompanyId TEXT NOT NULL
postingAdapterAuthorityBranchId TEXT NOT NULL
postingAdapterAuthorityKind TEXT NOT NULL
writeAuthorizationRecordId TEXT NOT NULL
activationRecordId TEXT NOT NULL
acceptedDryRunsHash TEXT NOT NULL
acceptedPr8EvidenceHash TEXT NOT NULL
dueDatePolicySetHash TEXT NOT NULL
selectedDueDateGateKind TEXT NOT NULL
selectedDueDatePolicyId TEXT NOT NULL
selectedDueDatePolicyVersion INTEGER NOT NULL
selectedDueDatePolicyHash TEXT NOT NULL
dueDateTreatment TEXT NOT NULL
unknownDueDateTreatmentMappingId TEXT NULL
unknownDueDateTreatmentMappingVersion INTEGER NULL
unknownDueDateTreatmentMappingHash TEXT NULL
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
`(companyId, operationType, idempotencyKey)`, `eventId`,
`(companyId,branchId,economicLineageKey)`, and
`canonicalReceivableId`, plus `financialAuditEventId`. Composite FKs connect event, source/producer/posting
authority bindings (source/posting directly and producer through the exact event),
authorization, activation, canonical receivable and financial audit.

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
economicLineageKey TEXT NULL
economicSourceRevisionKey TEXT NULL
economicLineageCandidateFingerprint TEXT NOT NULL
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
producerAuthorityRecordId TEXT NOT NULL
producerAuthorityVersion INTEGER NOT NULL
producerAuthorityRecordHash TEXT NOT NULL
producerAuthorityCompanyId TEXT NOT NULL
producerAuthorityBranchId TEXT NOT NULL
producerAuthorityKind TEXT NOT NULL
postingAdapterAuthorityRecordId TEXT NOT NULL
postingAdapterAuthorityVersion INTEGER NOT NULL
postingAdapterAuthorityRecordHash TEXT NOT NULL
postingAdapterAuthorityCompanyId TEXT NOT NULL
postingAdapterAuthorityBranchId TEXT NOT NULL
postingAdapterAuthorityKind TEXT NOT NULL
writeAuthorizationRecordId TEXT NOT NULL
activationRecordId TEXT NOT NULL
acceptedDryRunsHash TEXT NOT NULL
acceptedPr8EvidenceHash TEXT NOT NULL
sourceLineageHash TEXT NOT NULL
deniedAuthorityKind TEXT NULL
deniedAuthorityRecordId TEXT NULL
deniedAuthorityVersion INTEGER NULL
deniedAuthorityRecordHash TEXT NULL
correlationId TEXT NOT NULL
detectorVersion TEXT NOT NULL
conflictHash TEXT NOT NULL
schemaVersion INTEGER NOT NULL
detectedAt TEXT NOT NULL
createdAt TEXT NOT NULL
```

Conflict type is exactly one of the 49 literals in the complete section-22.8
registry: sixteen non-authority integrity types plus the Cartesian product of three
authority-kind prefixes and eleven authority-denial suffixes. No generic,
unregistered or implementation-selected conflict label is accepted. Severity is
always `p0`; unique key is `(companyId, conflictHash)`.

### Exact domains, checks and foreign-key graph

Every PR9 row has `schemaVersion = 1`; accepting a later integer without a new
migration is forbidden. All IDs, hashes, dates, timestamps, money and JSON use
section 5 limits. Every JSON array is canonical JSON, contains unique strings and
is ordered by its registered contract using the section-22.1 JCS comparator. Every
JSON object is canonical JSON. Every
scope has a concrete company and branch; wildcard-like branch values `*`, `all`,
`global`, `company-wide`, `company_wide`, `any` and `null`, case-insensitive, are
forbidden.

Exact additional domains are:

| Field | Exact v1 domain |
|---|---|
| authority `authorityKind` | `source_adapter`, `eligibility_producer`, `canonical_posting_adapter` |
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
| event economic row class | `conducted_upd_validated_coverage_slice_v1` |
| event `amountBasis` | `gross` |
| event `dueDateProvenance` | `invoice_due_date`, `contractual_payment_due_date`, `installment_due_date`, `unknown` |
| conflict `severity` | `p0` |
| conflict `detectorVersion` | `canonical-posting-conflict-detector-v1` |
| producer consumer `producerAuthorityKind` | `eligibility_producer` |
| posting consumer `postingAdapterAuthorityKind` | `canonical_posting_adapter` |

For authority, authorization and activation chains, version is a positive integer,
version 1 has no predecessor, and version N+1 names the exact latest N record of the
same logical ID and scope. Authority chain identity includes company, branch,
authority kind and scope-specific authority ID; the same actor may own multiple
independent chains, while a cross-scope predecessor is forbidden. `effectiveFrom <
expiresAt`; the interval is at most 24 hours and validity is the exact half-open
predicate `effectiveFrom <= attemptedAt < expiresAt`. `authorized` has no revocation
reason; every terminal state has a non-empty reason code and cannot return to
authorized in the same version. Record/hash and scoped logical-ID/version keys are
unique. Approval refs/hashes, owner refs and all required policy hashes are non-empty
and 64 hex characters where hash-typed.

For event rows: `eventVersion = 1`; `currency = RUB`; all three monetary values are
safe non-negative integers; `netAmountMinor + vatAmountMinor = grossAmountMinor`;
`originalAmountMinor = grossAmountMinor > 0`; dates form a non-empty half-open
interval. `unknown` requires null date and evidence ref; all other provenance
values require a valid date and non-empty evidence ref. PR8 candidate flags remain
exactly `diagnosticOnly = 1`, `canonicalWriteAuthorized = 0` and
`productionActivationAuthorized = 0`; no PR9 constraint reinterprets them.

Authorization and activation require canonical `DueDatePolicySetV1` JSON/hash with
both exact named PR8 gate decisions and the repository-owned unknown-treatment
mapping. Event and operation require the same policy-set hash and exactly one selected
gate ID/version/hash. Proven events require selected gate `contractual_due_date`,
its set member's `expectedSourceRef = dueDateProvenance`,
`dueDateTreatment = proven_contractual_date_v1` and null mapping fields. Unknown
events require selected gate `unknown_due_date_treatment`, source literal
`allow_unknown_without_aging`, `dueDateTreatment = post_without_aging_v1`, and the
exact non-null mapping ID/version/hash. Cross-gate or mixed triples abort.

Authorization also persists canonical `acceptedPr8EvidenceJson`/hash and the single
accepted timezone. Activation, event and operation bind the exact acceptance hash;
the authorization-accepted, activation, event, selected-PR8-run and fresh-PR5
timezone values must be byte-identical canonical IANA names. Activation requires
exact RFC3339-millisecond `forwardOnlyStartUtc`, exact
derivation from its civil `forwardOnlyStartDate`, and
`CHECK (boundaryEndUtc IS NULL)`. Event timezone snapshots must also be valid
canonical IANA names; aliases rejected by the registered canonicalizer are never
normalized silently.

Every event has non-null `economicLineageKey`, `economicSourceRevisionKey`,
`rootSourceDocumentLineageId`, `rootCoverageLineageId` and
`currentPr6RevisionHash`; the two key hashes must reproduce section 22.5 from the
locked PR6 graph. For operation rows, every field is non-null except the three
`unknownDueDateTreatmentMapping*` fields, which are all null for the proven gate and
all non-null for the unknown gate. All identities/hashes revalidate, and the exact
event, economic lineage key and canonical receivable each seal at most one operation. For
conflict rows, nullable event/operation/receivable references are permitted only when
the referenced row does not exist; otherwise scope and identity must match. The four
denied-authority columns follow the exact all-null/all-non-null registry rule below.
Expected and observed fingerprints must differ; `conflictObservationJson` must be
the exact canonical `ConflictObservationV1` and reproduce its
observation/expected/observed hashes. All
source, policy, lineage, command, result, record,
approval, cohort, boundary and evidence hashes are lowercase 64-hex values.

`acceptedDryRunsJson` is a canonical JSON array of objects with exactly the keys
`dryRunId` and `resultHash`, sorted by `dryRunId`, with no duplicate `dryRunId` and
one lowercase 64-hex result hash per ID. `acceptedDryRunsHash` must equal the exact
section 22 envelope in authorization, activation, event and operation/conflict
records. An ID and result hash can never be validated independently.

`acceptedPr8EvidenceJson` is the canonical section-13 array with no duplicate run,
pair, timezone or reconciliation-set member. Its pair projection and hash must match
`acceptedDryRunsJson`/`acceptedDryRunsHash`; its common timezone must match
`acceptedCompanyTimezoneSnapshot`; and `acceptedPr8EvidenceHash` must reproduce the
section-22 envelope everywhere it is persisted. Its ordered dry-run/window
projection must reproduce `acceptedFreshnessWindowsHash` in authorization and
activation. Missing, extra or independently
mixed members fail closed.

The exact foreign keys all use `ON UPDATE RESTRICT ON DELETE RESTRICT`:

| Child | Child columns → exact parent columns |
|---|---|
| every PR9 table | `companyId` → `canonical_companies(id)`; `(companyId, branchId)` → `canonical_branches(companyId, id)` |
| governed authority | `(previousRecordId,companyId,branchId,authorityKind,authorityId)` → the same table's exact prior scoped chain row; version trigger requires contiguous N+1 |
| write authorization | `previousRecordId` → same table `recordId`; `(activationBoundaryId, companyId, branchId)` → `billing_source_activation_boundaries(id, companyId, branchId)`; source binding `(sourceAdapterAuthorityRecordId, sourceAdapterAuthorityVersion, sourceAdapterAuthorityRecordHash, companyId, branchId)` → exact governed authority composite; producer binding `(producerAuthorityCompanyId,producerAuthorityBranchId,producerAuthorityKind,producerAuthorityRecordId,producerAuthorityVersion,producerAuthorityRecordHash)` and posting binding `(postingAdapterAuthorityCompanyId,postingAdapterAuthorityBranchId,postingAdapterAuthorityKind,postingAdapterAuthorityRecordId,postingAdapterAuthorityVersion,postingAdapterAuthorityRecordHash)` → exact governed authority parent `(companyId,branchId,authorityKind,recordId,authorityVersion,recordHash)`; child authority scope must equal row scope and kinds are fixed |
| posting activation | `previousRecordId` → same table `recordId`; `(activationBoundaryId, companyId, branchId)` → `billing_source_activation_boundaries(id, companyId, branchId)`; `writeAuthorizationRecordId` → write authorization `recordId`; full posting-adapter authority composite → the exact write-authorization-bound governed record |
| eligible event PR8 | `(dryRunId, companyId, branchId)` → `actual_source_dry_runs(id, companyId, branchId)`; `(candidateId, dryRunId, companyId, branchId)` → `actual_source_dry_run_candidates(id, runId, companyId, branchId)` |
| eligible event PR6 | each of `activationBoundaryId`, `rentalLineId`, `periodId`, `closedPeriodVersionId`, `snapshotId`, `updId`, `formedUpdVersionId`, `conductedUpdVersionId`, `updLineId`, `updLineVersionId`, `coverageSetId`, `coverageSliceId` with `(companyId, branchId)` → the same-ID scoped key of the corresponding `billing_source_*` table |
| eligible event PR9 | `activationRecordId` → posting activation `recordId`; source binding composite and full producer authority composite → exact governed records; `writeAuthorizationRecordId` → write authorization `recordId` |
| posting operation | `eventId` → eligible event `id`; source binding composite and full posting-adapter authority composite → exact governed records; `writeAuthorizationRecordId` → write authorization `recordId`; `activationRecordId` → posting activation `recordId`; `(companyId, canonicalReceivableId, branchId)` → `canonical_receivables(companyId, id, branchId)`; `(financialAuditEventId, companyId, branchId)` → `financial_audit_events(id, companyId, branchId)` deferred until commit |
| posting conflict | nullable `eventId` → eligible event `id`; nullable `existingOperationId` → posting operation `id`; nullable `(companyId, existingReceivableId, branchId)` → `canonical_receivables(companyId, id, branchId)`; source and producer full composites equal the immutable attempt-bound write-authorization bindings, posting-adapter full composite equals that authorization's and activation's common attempt binding, and any referenced event/operation must reproduce the applicable same composites; all reference exact scoped PR9 parents without asserting current lifecycle; nullable denied-authority composite `(deniedAuthorityRecordId,deniedAuthorityVersion,deniedAuthorityRecordHash,companyId,branchId)` → the exact observed governed record when Algorithm C persistence is permitted |

Single-column PR9 primary-effect record references are additionally guarded by
before-insert triggers that require exact company, branch, logical kind/status and
current version; an ID existing in another scope is never sufficient. Conflict-table
references are evidence-only and follow the exact attempt-bound/observed-denied rules
below instead of asserting current authority. The PR8 and PR6 composite FKs are
ordered exactly as shown. No JSON reference substitutes for a relational FK.

### Indexes

Exact additional index definitions:

| Name | Unique | Ordered columns |
|---|---|---|
| `uq_pr9_adapter_authority_version` | yes | `companyId, branchId, authorityKind, authorityId, authorityVersion` |
| `uq_pr9_adapter_authority_hash` | yes | `recordHash` |
| `uq_pr9_adapter_authority_source_binding` | yes | `recordId, authorityVersion, recordHash, companyId, branchId` |
| `uq_pr9_adapter_authority_binding` | yes | `companyId, branchId, authorityKind, recordId, authorityVersion, recordHash` |
| `uq_pr9_adapter_authority_chain_parent` | yes | `recordId, companyId, branchId, authorityKind, authorityId` |
| `idx_pr9_adapter_authority_scope` | no | `companyId, branchId, authorityKind, authorityId, status, expiresAt` |
| `uq_pr9_write_authorization_version` | yes | `authorizationId, authorizationVersion` |
| `uq_pr9_write_authorization_hash` | yes | `recordHash` |
| `idx_pr9_write_authorization_scope` | no | `companyId, branchId, status, expiresAt` |
| `uq_pr9_activation_version` | yes | `activationId, activationVersion` |
| `uq_pr9_activation_hash` | yes | `recordHash` |
| `idx_pr9_activation_scope` | no | `companyId, branchId, status, expiresAt` |
| `uq_pr9_eligible_economic_lineage` | yes | `companyId, branchId, economicLineageKey` |
| `uq_pr9_eligible_source_revision` | yes | `companyId, branchId, economicSourceRevisionKey` |
| `uq_pr9_eligible_event_hash` | yes | `companyId, eventHash` |
| `uq_pr9_eligible_candidate` | yes | `dryRunId, candidateId` |
| `idx_pr9_eligible_scope` | no | `companyId, branchId, createdAt` |
| `uq_pr9_posting_operation_idempotency` | yes | `companyId, operationType, idempotencyKey` |
| `uq_pr9_posting_operation_event` | yes | `eventId` |
| `uq_pr9_posting_operation_lineage` | yes | `companyId, branchId, economicLineageKey` |
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
trg_pr9_write_authorization_producer_validate
trg_pr9_write_authorization_posting_adapter_validate
trg_pr9_activation_posting_adapter_validate
trg_pr9_event_source_adapter_validate
trg_pr9_event_producer_validate
trg_pr9_operation_source_adapter_validate
trg_pr9_operation_posting_adapter_validate
trg_pr9_conflict_source_adapter_validate
trg_pr9_conflict_producer_validate
trg_pr9_conflict_posting_adapter_validate
trg_pr9_conflict_denied_authority_validate
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
| `trg_pr9_write_authorization_producer_validate` | `canonical_write_authorization_records` | `BEFORE INSERT` |
| `trg_pr9_write_authorization_posting_adapter_validate` | `canonical_write_authorization_records` | `BEFORE INSERT` |
| `trg_pr9_activation_posting_adapter_validate` | `canonical_posting_activation_records` | `BEFORE INSERT` |
| `trg_pr9_event_source_adapter_validate` | `actual_receivable_eligible_events` | `BEFORE INSERT` |
| `trg_pr9_event_producer_validate` | `actual_receivable_eligible_events` | `BEFORE INSERT` |
| `trg_pr9_operation_source_adapter_validate` | `canonical_receivable_posting_operations` | `BEFORE INSERT` |
| `trg_pr9_operation_posting_adapter_validate` | `canonical_receivable_posting_operations` | `BEFORE INSERT` |
| `trg_pr9_conflict_source_adapter_validate` | `canonical_receivable_posting_conflicts` | `BEFORE INSERT` |
| `trg_pr9_conflict_producer_validate` | `canonical_receivable_posting_conflicts` | `BEFORE INSERT` |
| `trg_pr9_conflict_posting_adapter_validate` | `canonical_receivable_posting_conflicts` | `BEFORE INSERT` |
| `trg_pr9_conflict_denied_authority_validate` | `canonical_receivable_posting_conflicts` | `BEFORE INSERT` |
| `trg_pr9_event_before_operation_seal` | `canonical_receivable_posting_operations` | `BEFORE INSERT` |
| `trg_pr9_operation_finalize` | `canonical_receivable_posting_operations` | `BEFORE INSERT` |
| `trg_pr9_financial_audit_scope_validate_after_insert` | `financial_audit_events` | `AFTER INSERT`; activates when an operation references `NEW.id`, regardless of `NEW.eventType` |
| `trg_pr9_canonical_receivable_no_delete` | `canonical_receivables` | `BEFORE DELETE`, only for the PR9 source system |
| `trg_pr9_canonical_receivable_full_immutability` | `canonical_receivables` | `BEFORE UPDATE`, only for the PR9 source system |

Every table-local trigger aborts rather than ignores the prohibited statement.
`no_replace` rejects an insert whose primary key or business unique key already
exists; repositories must classify replay before insert. The version-chain triggers
require version 1 with no predecessor or exact contiguous version N+1 linked to the
latest N row of the same company/branch/authority-kind/scope-specific-ID chain; actor
reuse never joins chains. The event-before-operation trigger requires the exact
event/hash and current authority chain. The four table-specific source-adapter binding triggers
apply before insert on authorization, event, operation and conflict respectively.
Each requires the composite ID, version, record hash, company and branch to name
the exact scoped `source_adapter` record with operation `source_lineage.read.v1`,
exact logical source system, source row classes, artifact digest, commit,
configuration, policy and ownership manifest expected by the row. The first three
also require the latest record to be currently `authorized`; the conflict trigger
verifies the immutable denied-attempt binding even when a terminal lifecycle was
the reason for denial and grants no primary effect.

The producer and posting-adapter triggers require the literal child
ID/version/recordHash/company/branch/kind composite to reference the exact
scope-specific `eligibility_producer` or `canonical_posting_adapter` chain and reject
ID-only, wrong-version/hash and cross-company/branch references. Authorization,
activation, event and operation consumer triggers additionally require the registered
operation, actor, artifact/configuration/policy/ownership bindings and the unique
latest currently `authorized` version. Activation binds the same posting composite as
its write authorization; events bind the producer composite; operations bind the
posting composite.

The conflict source/producer/posting triggers instead validate all three exact
immutable attempt-bound composites from the denied write authorization: source and
producer equal its bindings, posting equals its and the activation's common binding,
and any referenced event/operation reproduces the applicable same composites. Each
trigger joins its attempt-bound parent and derives the logical `authorityId`; the
conflict table does not accept a caller-supplied logical ID. Company, branch, kind,
physical record ID, version, persisted record hash and derived logical authority ID
must all agree. These evidence bindings cannot authorize or be reused by a
primary-effect consumer.

The selected denial kind's attempt-bound record may be stale, terminal or non-latest.
Its non-null `deniedAuthority*` composite must join an observed parent with the same
company, branch, kind and logical `authorityId`, and must satisfy the exact
suffix-specific same-chain rule in section 22.8. The observed parent is separate from
the attempt binding: substituting it into the top-level attempt columns, using another
authority chain, skipping a version, or changing any scope/kind/ID/version/persisted
hash aborts. `deniedAuthorityRecordHash` always equals the observed parent's persisted
hash; a reconstructed hash difference remains inside the exact observed projection.

Collectively the four conflict authority triggers execute this exact proof before
insert:

1. derive the selected prefix/suffix from the registered `conflictType`;
2. bind all three immutable attempt composites to the denied write authorization,
   activation and any event/operation as above;
3. reconstruct all three complete same-scope logical authority chains and every
   applicable denial candidate under the locked Algorithm-C `attemptedAt`;
4. select exactly one candidate using the section-22.8 kind-major and suffix
   precedence;
5. require the selected observed parent to satisfy its same-chain suffix relation;
6. require every authority kind with no denial candidate to be the unique latest
   `authorized` record active at `attemptedAt` with exact scope/kind/ID/version/hash;
   a concurrent lower-precedence denial may be safely reconstructed and suppressed,
   but it is not falsely classified as unaffected;
7. reject the insert if any higher-precedence denial exists, if a concurrent denial
   is ambiguous/unsafe, or if the selected type/projection differs from the unique
   precedence result;
8. recompute and compare the expected/observed side fingerprints,
   `conflictObservationHash` and `conflictHash` before accepting the row.

Thus producer revocation with a simultaneous source denial can persist only the
source observation; producer revocation with active/latest source and posting can
persist the producer observation. Cross-authorityId, cross-company, cross-branch,
cross-kind, non-contiguous or lower-precedence evidence aborts. For a non-authority
conflict all `deniedAuthority*` columns are null and all three authority chains must be
active/latest. A registry state marked `not allowed` cannot satisfy these triggers
because the repository must perform no conflict insert.

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
type, `occurredAt = createdAt = operation.createdAt`, exact reason literal,
`previousValueJson IS NULL`, exact source-system literal, payload
`actorAuthorityRecordId = operation.postingAdapterAuthorityRecordId`, exact authority/event
identities, exact new-value key set, canonical payload fingerprint and prospective
audit-event fingerprint equal to the operation seal. Wrong event type, scope,
correlation, aggregate, actor identity, actor authority, timestamp, reason,
previous-value nullness, source system, payload key/value, fingerprint or
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
| `sourceLineId` | event `rootCoverageLineageId` | stable correction-lineage identity; current `coverageSliceId` remains in event/operation/audit only |
| source document version | event `conductedUpdVersionId` in event/operation/audit | PR1 has no column; mismatch blocks |
| rental line | event `rentalLineId` in event/operation/audit | PR1 has no column; mismatch blocks |
| `externalId` | event `economicLineageKey` | unique stable economic lineage within company |
| economic lineage/revision | event `economicLineageKey` mapped to `externalId`; event/operation retain `economicSourceRevisionKey` | same lineage with changed current revision is a registered correction/revision conflict, never a second receivable |
| `idempotencyKey` | repository-derived `CanonicalPostingIdempotencyKeyV1` from section 22.10 | caller value forbidden; same source with changed event is conflict |
| `currency` | `RUB` | other currency blocks |
| `originalAmountMinor` | event `grossAmountMinor` | must equal approved event basis |
| `issuedAt` | current conducted UPD version `createdAt` | source drift blocks |
| `postedAt` | repository transaction timestamp | generated once |
| `contractualDueDate` | event date or null for approved unknown | difference blocks |
| `dueDateProvenance` | event provenance | difference blocks |
| due-date policy binding | event `dueDatePolicySetHash`, selected gate kind/ID/version/hash, treatment and nullable unknown-mapping triple; sealed in operation/audit | proven selects only `contractual_due_date`; unknown selects only `unknown_due_date_treatment`; any mixed or changed member is `DUE_DATE_POLICY_DRIFT` |
| `companyTimezone` | event `companyTimezoneSnapshot`, originally copied from the accepted PR8 run after locked equality with acceptance, activation and fresh PR5 authority | fresh PR5 mismatch/unavailability blocks; never replace an accepted/event snapshot with a newer mutable value |
| `workflowStatus` | literal `posted` | draft forbidden |
| `description` | literal `Governed UPD coverage slice` | no customer data |
| `createdAt`, `updatedAt` | same repository transaction timestamp | immutable |
| `version` | `1` | immutable |
| correlation ID | event/operation/audit only | PR1 row has no column |

`cancellationReason`, `cancelledAt`, `closedAt` and `writtenOffAt` are null. A
conflict under any mapped field creates no second receivable and no update.
The existing PR1 unique external identity receives `economicLineageKey`, and its
source identity receives stable `rootCoverageLineageId`; together with the PR9
operation lineage unique index and Algorithm-B full-chain lookup, they enforce at
most one canonical coverage fact per company/branch lineage even when current PR6
version/set/slice IDs change.

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
deduplicated `CanonicalPostingConflictV1` row only when section 22.8 marks that exact
denial `required`. A `not allowed` denial performs no conflict DML and immediately
opens the P0 telemetry circuit. Failure to persist required conflict evidence never
permits posting; it raises a P0 telemetry failure and opens the circuit.

Primary-effect authority and denial-evidence authority are separate. The write
authorization enumerates the three primary-effect tables independently from the
single denial table and grants only the exact repository-owned append permission
`canonical_receivable_posting_conflicts.append_after_denial.v1`. After a
deterministic denial whose registry persistence is `required`, the repository must
open a new transaction, reread that exact permission and all applicable source,
producer and posting authority, authorization, activation and scope
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
no canonical effect and records the approved conflict evidence when registry
persistence is `required`; unsafe cross-scope/ambiguous bindings are intentionally
not persisted and open the circuit.

Before every event or posting decision, the repository traverses the complete locked
PR6 predecessor/replacement graph to the unique root source document and unique root
coverage slice. A replacement before the first event may become the current revision
of that stable lineage. Once an event exists, a different revision is
`SOURCE_CORRECTION_AFTER_ELIGIBILITY`; once the canonical row exists it is
`SOURCE_CORRECTION_AFTER_POSTING`. A same-revision content/hash change is
`SOURCE_REVISION_CHANGED_BEFORE_POSTING`; ambiguous roots or multiple active current
revisions use their registered root/current conflict types. None may create another
event or receivable.

If the canonical row already exists, PR9 never updates or deletes it. The condition
is a P0 post-posting source-change incident for reconciliation and a future
correction/compensation PR. Its conflict evidence uses the exact root type from
`ConflictObservationV1`—for example `PR6_LINEAGE_DRIFT`,
`DUE_DATE_POLICY_DRIFT`, `SOURCE_ADAPTER_REVOKED` or
`ELIGIBILITY_PRODUCER_EXPIRED`, and the five exact source revision/root types above—
rather than inventing a generic
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
| conflict circuit breaker | immediate for all 33 authority-denial types and the fourteen non-authority integrity types listed as immediate in section 22.8; 5 `AUTHORIZATION_DRIFT`/`ACTIVATION_DRIFT` conflicts in 5 minutes per company/branch |
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
`domain` and `version` are mandatory anti-confusion fields. Canonical JSON is RFC
8785/JCS-compatible with these stricter rentCore rules:

- input decoded from bytes must be valid shortest-form UTF-8; in-memory strings must
  be valid Unicode scalar sequences; invalid UTF-8 and lone UTF-16 surrogates reject;
- Unicode normalization is never implicit. Precomposed and combining sequences
  remain different strings and therefore different hashes;
- object property names sort by their unescaped UTF-16 code-unit sequences exactly
  as RFC 8785 requires, not by locale, ASCII or UTF-8 byte order; duplicate property
  names reject before canonicalization;
- arrays retain only their contract-defined order. Any contract that defines a
  sorted string array uses the same RFC-8785 property-name comparator over the
  unescaped strings; duplicate members reject;
- quotation mark and reverse solidus serialize as `\"` and `\\`; U+0008, U+0009,
  U+000A, U+000C and U+000D use `\b`, `\t`, `\n`, `\f` and `\r`; every other
  U+0000–U+001F code point uses lowercase `\u00xx`; slash `/` is not escaped;
- valid non-ASCII scalar values, including Cyrillic, Tatar characters, emoji/non-BMP
  and U+2028/U+2029, are emitted as their scalar values and then encoded as UTF-8,
  not converted to `\u` escapes or surrogate-pair escapes;
- JSON null is exactly `null`, booleans are exactly `true`/`false`, and omission is
  never interchangeable with null or an empty string;
- floating point, negative zero, NaN, infinities, bigint and unsafe integers reject.
  Allowed integers use the JCS/ECMAScript decimal rendering; under the safe-integer
  restriction this is base-10 with no plus sign, padding, exponent or decimal point;
- the hash input is the exact canonical UTF-8 byte sequence with no BOM, no
  insignificant whitespace and no trailing byte; the digest is lowercase SHA-256.

For each envelope PR9a fixtures must publish the exact canonical byte string and
lowercase SHA-256 hex. Cross-language JavaScript plus one independent implementation
fixtures are mandatory for Cyrillic, Tatar `ә/ө/ү/җ/ң/һ`, emoji/non-BMP, slash,
quotation mark, reverse solidus, every control-character escape class, U+2028,
U+2029, precomposed versus combining sequences, null, array order and maximum safe
integer. Lone-surrogate and invalid-UTF-8 fixtures must reject. A field not listed in
an envelope is excluded; there are no implicit fields.

### 22.2 `GovernedAdapterAuthorityV1`

Required fields are every authority column; only `previousRecordId`,
`credentialFingerprint`, `credentialIssuerRef` and `revocationReasonCode` may be
null under their enum rules. Identity is
`companyId + branchId + authorityKind + authorityId + authorityVersion`.
`recordHash` uses domain `rentcore.governed_adapter_authority.record`, version `1`
and exactly:

```text
{ actorId, allowedOperation, approvalHash, approvalRef,
  artifactDigest, authorityId, authorityVersion, branchId, companyId,
  configurationHash, credentialFingerprint, credentialIssuerRef, credentialType,
  domain, effectiveFrom, environment, expiresAt, authorityKind, ownerRef, policyHash,
  previousRecordId, revocationReasonCode, schemaVersion, sourceCommitSha,
  sourceOwnershipManifestHash, sourceRowClassesJson, sourceSystemIdsJson, status,
  version }
```

The exact exclusions are `recordId`, `recordHash` and `createdAt`. Latest means the
highest contiguous version within the exact company/branch/kind/authority chain.
The repository recomputes the scope-specific `authorityId` formula from section 10;
a different scope, kind or actor cannot join the chain. Same identity/content
replays, changed content conflicts, and a terminal/current mismatch blocks.

### 22.3 Accepted PR8 pair set

`acceptedDryRunsHash = sha256(canonicalJson({acceptedDryRuns,domain,version}))`,
where `domain = rentcore.canonical_actual_posting.accepted_dry_runs`, `version = 1`
and `acceptedDryRuns` is a non-empty array of objects with exactly `dryRunId` and
`resultHash`, sorted ascending by `dryRunId` with the section-22.1 JCS string
comparator and no duplicate ID.
Authorization creation and every locked event/posting/conflict validation reread
the persisted PR8 run result and match both members of every accepted pair.

`acceptedPr8EvidenceHash` uses domain
`rentcore.canonical_actual_posting.accepted_pr8_evidence`, version `1`, and exactly:

```text
{ acceptedDryRunsHash, acceptedFreshnessWindowsHash, acceptedRuns, domain,
  evidencePackHash, version }
```

`acceptedRuns` is the exact `acceptedPr8EvidenceJson` array from section 13. It is
sorted with the same comparator by `dryRunId`; every entry has exactly
`companyTimezoneSnapshot`, `dryRunId`, `finalizedAt`, `freshnessDurationMs`,
`freshnessPolicyHash`, `freshnessPolicyId`, `freshnessPolicyVersion`,
`freshnessWindowFingerprint`, `policyManifestHash`, `reconciliationSetHash`,
`resultHash`, `sourceInputManifestHash`, `sourceOwnershipManifestHash`, `validFrom`
and `validUntilExclusive`. Its pair projection must reproduce
`acceptedDryRunsHash`. `reconciliationSetHash` uses domain
`rentcore.canonical_actual_posting.pr8_reconciliation_set`, version `1`, and exactly
`{domain,dryRunId,reconciliationHashes,version}`, where hashes are the complete exact
row set ordered by hash and every hash appears once in the sealed PR8 result.
The freshness members must reproduce the exact section-13 half-open integer-
millisecond window and its fingerprints. Every entry must carry the same canonical
`companyTimezoneSnapshot`; the derived
common value is persisted as `acceptedCompanyTimezoneSnapshot`. Neither the pair
hash nor PR8 `resultHash` can substitute for this acceptance hash.

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
`rowVersion`; table/ID use the section-22.1 JCS string comparator and JSON null sorts
before positive integer versions. Nullable source versions are JSON null. The
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

`currentPr6RevisionHash` is the PR6-only revision seal. It uses domain
`rentcore.canonical_actual_posting.pr6_current_revision`, version `1`, and exactly:

```text
{ branchId, companyId, conductedUpdContentHash, conductedUpdVersionId,
  coverageSetId, coverageSetMappingHash, coverageSliceHash, coverageSliceId,
  domain, formedUpdVersionId,
  pr6LineageRows:[{rowFingerprint,rowId,rowVersion,tableName}],
  updLineVersionContentHash, updLineVersionId, version }
```

The `pr6LineageRows` array is the exact section-22.4 locked closure. The four named
content/mapping hashes come from their exact current persisted PR6 rows. PR8,
authority, authorization, activation and timestamps introduced outside PR6 are
excluded. This seal therefore changes for a current source revision or PR6 graph
change without confusing it with a policy or actor change.

### 22.5 `ActualReceivableEligibleV1`

The repository uses two exact identities. First, it resolves the correction lineage
under lock. `rootSourceDocumentLineageId` is the one stable PR6
`billing_source_upds.id` (`updId`) shared by every set/slice in the accepted chain.
Starting at the current coverage set/slice, it repeatedly finds the unique
`billing_source_coverage_supersessions` row whose
`replacementCoverageSetId = currentCoverageSetId`, requires action `corrected` or
`superseded`, and moves to that row's `originalCoverageSetId`. At each predecessor
set it selects exactly one slice with byte-identical company, branch, source-system
literal, `updId`, `contractId`, `rentalId`, `rentalLineId`, `periodId`, half-open
coverage interval, currency and economic row class. Traversal stops at the unique
set/slice with no predecessor. A linked replacement that changes any of these
lineage-defining members is a cross-lineage collision, not a new economic identity.

The derived stable root ID is:

```text
rootCoverageLineageId = "coverage-lineage:" + sha256(canonicalJson({
  branchId, companyId, domain, rootCoverageSetId, rootCoverageSliceId,
  rootSourceDocumentLineageId, version
}))
```

Here domain is `rentcore.canonical_actual_posting.coverage_lineage_root`, version is
`1`, and the root set/slice IDs are immutable PR6 IDs. A missing edge, cycle,
cross-scope/cross-UPD edge, zero or multiple matching predecessors, two disconnected
roots with the same apparent economic dimensions, or more than one active current
revision fails before identity construction using the registered section-22.8
conflict. The repository scans the complete same-scope PR6 graph, not only the
caller/current path.

The policy-independent economic identity is:

```text
economicLineageKey = sha256(canonicalJson({
  branchId, companyId, contractId, coverageEndExclusive, coverageStart,
  currency, domain, economicRowClass, rentalId, rentalLineId,
  rootCoverageLineageId, rootSourceDocumentLineageId, schemaVersion,
  sourceSystem, version
}))
```

Here `domain = rentcore.canonical_actual_posting.economic_lineage_key`, envelope
`version = 1`, `economicRowClass = conducted_upd_validated_coverage_slice_v1`,
`coverageStart = sliceStartDate`, and `coverageEndExclusive =
sliceEndDateExclusive`. The key explicitly excludes current UPD version, coverage
set/slice IDs, amount, due date/provenance/evidence, every policy hash, PR8
acceptance, adapter/producer/posting authority, write authorization, activation,
lifecycle status, timestamps, generated IDs and correlation.
`(companyId,branchId,economicLineageKey)` is unique.

The exact current-revision identity is:

```text
economicSourceRevisionKey = sha256(canonicalJson({
  branchId, companyId, conductedUpdVersionId, coverageSetId, coverageSliceId,
  currentPr6RevisionHash, domain, economicLineageKey, formedUpdVersionId,
  updLineVersionId, version
}))
```

Its domain is `rentcore.canonical_actual_posting.economic_source_revision`, version
`1`. It binds the exact current PR6 revision while the lineage key remains stable.
`(companyId,branchId,economicSourceRevisionKey)` is unique. Before the first event,
the unique latest valid replacement may supersede its predecessor and supply the
current revision. After an event exists, a different revision conflicts and cannot
append a second event. After posting, any different correction/replacement revision
is a post-posting conflict and cannot append a second canonical row.

`eventHash` uses domain `rentcore.canonical_actual_posting.eligible_event`, version
`1`, and every persisted event field in section 14 except exactly generated `id`
and `eventHash`, plus `domain` and envelope `version`.
Therefore its exact ordered member set is: `acceptedDryRunsHash`,
`acceptedPr8EvidenceHash`,
`activationBoundaryId`, `activationCohortRef`, `activationRecordId`, `amountBasis`,
`amountBasisPolicyHash`, `amountBasisPolicyRef`, `branchId`, `candidateId`,
`candidateResultHash`, `clientId`, `closedPeriodVersionId`, `cohortHash`,
`companyId`, `companyTimezoneSnapshot`, `completeInputSetHash`,
`conductedUpdVersionId`, `contractId`,
`contractualDueDate`, `correlationId`, `coverageSetId`, `coverageSliceId`,
`createdAt`, `currency`, `domain`, `dryRunId`, `dueDateEvidenceRef`,
`currentPr6RevisionHash`, `dueDatePolicySetHash`, `dueDateProvenance`,
`dueDateTreatment`, `economicLineageKey`, `economicSourceRevisionKey`,
`eventSchemaVersion`, `eventVersion`, `formedUpdVersionId`, `grossAmountMinor`,
`netAmountMinor`, `occurredAt`, `originalAmountMinor`, `periodId`, `policyManifestHash`,
`producerAuthorityBranchId`, `producerAuthorityCompanyId`,
`producerAuthorityKind`, `producerAuthorityRecordHash`,
`producerAuthorityRecordId`, `producerAuthorityVersion`, `rentalId`,
`rentalLineId`, `rootCoverageLineageId`, `rootSourceDocumentLineageId`,
`schemaVersion`,
`sliceEndDateExclusive`, `sliceStartDate`, `snapshotId`,
`sourceAdapterAuthorityRecordHash`, `sourceAdapterAuthorityRecordId`,
`sourceAdapterAuthorityVersion`, `sourceLineageHash`,
`sourceOwnershipManifestHash`, `selectedDueDateGateKind`,
`selectedDueDatePolicyHash`, `selectedDueDatePolicyId`,
`selectedDueDatePolicyVersion`, `unknownDueDateTreatmentMappingHash`,
`unknownDueDateTreatmentMappingId`, `unknownDueDateTreatmentMappingVersion`,
`updId`, `updLineId`, `updLineVersionId`, `vatAmountMinor`, `version`,
`writeAuthorizationRecordId`.

For a new event, `occurredAt = createdAt = attemptedAt` and `correlationId` is the
pre-generated repository value. For replay comparison the repository uses the
existing event's persisted `occurredAt`, `createdAt` and `correlationId`, not the new
attempt clock or candidate ID, so generated attempt metadata remains sealed without
forking identity. Same lineage key, revision key and event hash is exact replay.
Same lineage key with changed revision uses the specific correction/revision conflict
from section 22.8. Same lineage and revision with any changed event content,
including amount, due-date, policy, evidence or authority, is one deterministic
conflict and never a second event. A changed or unavailable fresh PR5 timezone does
not alter the existing event; it denies replay/posting as `COMPANY_TIMEZONE_DRIFT`.

### 22.5.1 `DueDatePolicySetV1` and unknown-treatment mapping

`UnknownDueDatePostingTreatmentMappingV1` uses domain
`rentcore.canonical_actual_posting.unknown_due_date_mapping`, version `1`, and
exactly:

```text
{ agingTreatment, contractualDueDate, domain, mappingId, mappingVersion,
  postingTreatment, sourceDecisionLiteral, sourceGateKind, version }
```

The exact values are `agingTreatment = excluded_from_aging`,
`contractualDueDate = null`,
`mappingId = rentcore.unknown_due_date_posting_treatment.v1`,
`mappingVersion = 1`, `postingTreatment = post_without_aging_v1`,
`sourceDecisionLiteral = allow_unknown_without_aging`, and
`sourceGateKind = unknown_due_date_treatment`. `mappingHash` is SHA-256 of this
envelope. The source literal remains a PR8 fact; the posting treatment is a distinct
PR9 projection. Unknown source literals, mapping drift or caller-selected treatment
deny without changing PR8.

`DueDatePolicySetV1` uses domain
`rentcore.canonical_actual_posting.due_date_policy_set`, version `1`, and exactly:

```text
{ contractualDueDate:{expectedSourceRef,gateKind,policyHash,policyId,policyVersion}, domain,
  unknownDueDateTreatment:{decisionLiteral,gateKind,mappingHash,mappingId,
    mappingVersion,policyHash,policyId,policyVersion}, version }
```

The two gate kinds are the exact literals from section 7. Each policy ID/version/hash
comes from that named accepted PR8 policy-manifest member; the contractual member's
exact `expectedSourceRef` must equal the proven event provenance. Cross-member or
cross-provenance substitution rejects. `dueDatePolicySetJson` is this exact object
without outer `domain`/`version`;
`dueDatePolicySetHash` is SHA-256 of the complete envelope. Authorization and
activation persist both. An event/operation carries the set hash plus exactly one
selected member. For proven provenance only the contractual member may be selected
and all mapping fields are null. For unknown only the unknown member may be selected
and every mapping member must match this envelope.

### 22.6 `CanonicalWriteAuthorizationV1` and activation

Required authorization fields are every column except nullable `previousRecordId`
and `revocationReasonCode`. Identity is `authorizationId + authorizationVersion`.
Its record hash uses domain `rentcore.canonical_actual_posting.write_authorization`,
version `1`, and exactly:

```text
{ acceptedCompanyTimezoneSnapshot, acceptedDryRunsHash, acceptedDryRunsJson,
  acceptedPr8EvidenceHash, acceptedPr8EvidenceJson, activationBoundaryId,
  activationCohortRef, amountBasisPolicyHash, amountBasisPolicyRef,
  approvalSetJson, authorizationId, authorizationVersion, backupEvidenceRef,
  boundaryHash, branchId, cohortHash, companyId, denialEvidencePermission,
  denialEvidenceTable, domain, dueDatePolicySetHash, dueDatePolicySetJson,
  effectiveFrom,
  eventSchemaVersion, evidencePackHash, expiresAt, forbiddenOperationsJson,
  acceptedFreshnessWindowsHash, operationType, operationalControlRef,
  policyManifestHashesJson, postingAdapterAuthorityBranchId,
  postingAdapterAuthorityCompanyId, postingAdapterAuthorityKind,
  postingAdapterAuthorityRecordHash, postingAdapterAuthorityRecordId,
  postingAdapterAuthorityVersion, previousRecordId, primaryEffectTablesJson,
  producerAuthorityBranchId, producerAuthorityCompanyId, producerAuthorityKind,
  producerAuthorityRecordHash, producerAuthorityRecordId,
  producerAuthorityVersion, retentionControlRef, revocationReasonCode,
  schemaVersion, sourceAdapterAuthorityRecordHash,
  sourceAdapterAuthorityRecordId, sourceAdapterAuthorityVersion,
  sourceOwnershipManifestHash, sourceSystemIdsJson, status, version }
```

The exact exclusions are `recordId`, `recordHash` and `createdAt`.
`authorizationHash` means this exact persisted `recordHash`; no second or
caller-computed authorization hash exists.
This authorization `recordHash` is the single authorization seal over every exact
member listed in the preceding envelope, including both full producer and posting
composites. `acceptedPr8EvidenceHash`
remains an evidence-only hash and does not silently acquire runtime actor semantics.
The due-date policy set, acceptance record/hash, pair projection and accepted
timezone/freshness window and both producer/posting full authority composites are
compared as one unit during authorization creation and every Algorithm
A/B/C reread; no member may be independently supplied or mixed with another version.

The approval set must contain stable refs/hashes for product, accountant/finance,
legal, tax, security/identity, release/operations, source-adapter owner, producer
owner, posting-adapter owner and independent reconciliation reviewer. Gate A creates
none. Expiry/revocation blocks primary effects even on replay; denial evidence is
limited by section 17 and algorithm C.

`CanonicalPostingActivationV1` identity is `activationId + activationVersion`.
Its record hash uses domain `rentcore.canonical_actual_posting.activation`, version
`1`, and exactly:

```text
{ acceptedDryRunsHash, acceptedPr8EvidenceHash, activationBoundaryId, activationId,
  activationVersion,
  allowedDocumentClassesJson, allowedRentalClassesJson, approvalHash, approvalRef,
  boundaryEndUtc, boundaryHash, branchId, cohortHash, companyId,
  companyTimezoneSnapshot, currency, domain, dueDatePolicySetHash,
  dueDatePolicySetJson, effectiveFrom, explicitExclusionsJson, expiresAt,
  acceptedFreshnessWindowsHash, forwardOnlyStartDate, forwardOnlyStartUtc,
  policyManifestHashesJson, postingAdapterAuthorityBranchId,
  postingAdapterAuthorityCompanyId, postingAdapterAuthorityKind,
  postingAdapterAuthorityRecordHash, postingAdapterAuthorityRecordId,
  postingAdapterAuthorityVersion, previousRecordId, revocationReasonCode,
  schemaVersion, sourceSystemIdsJson, status, version,
  writeAuthorizationRecordId }
```

Apart from chain-conditional `previousRecordId` and `revocationReasonCode`,
`boundaryEndUtc` is the only nullable activation column and must nevertheless be
SQL/JSON null for every v1 row; `CHECK (boundaryEndUtc IS NULL)` is mandatory.
`activationHash` means this exact persisted `recordHash`; no parallel hash exists.
The exact exclusions are `recordId`, `recordHash` and `createdAt`. It seals
`acceptedDryRunsHash`, `acceptedPr8EvidenceHash`, the accepted timezone/freshness
window, policy set and exact posting-adapter authority ID/version/hash/scope/kind.
It is default denied when missing, ambiguous, ineffective, expired, revoked,
superseded, bounded in v1 or mismatched. Deployment creates or selects no activation.

### 22.7 Posting fingerprints

`CanonicalPostingCommandFingerprintV1` is the `commandFingerprint` used only by
Algorithm B. It requires an already persisted `eventId`, has domain
`rentcore.canonical_actual_posting.command`, version `1`, and exactly:

```text
{ assertedDueDatePolicySetHash, assertedDueDateTreatment,
  assertedEventHash, assertedSelectedDueDateGateKind,
  assertedSelectedDueDatePolicyHash, assertedSelectedDueDatePolicyId,
  assertedSelectedDueDatePolicyVersion,
  assertedUnknownDueDateTreatmentMappingHash,
  assertedUnknownDueDateTreatmentMappingId,
  assertedUnknownDueDateTreatmentMappingVersion,
  assertedWriteAuthorizationRecordId, branchId, companyId, domain, eventId,
  operationType,
  requestedActivationRecordId, requestedPostingAdapterAuthorityRecordHash,
  requestedPostingAdapterAuthorityRecordId,
  requestedPostingAdapterAuthorityVersion,
  requestedSourceAdapterAuthorityRecordId, version }
```

These are inert pre-lock selectors/assertions only; none decides authority. The
caller supplies no idempotency key: it is derived only after locked relational
reread by `CanonicalPostingIdempotencyKeyV1`. Algorithm A does not compute this
fingerprint and has no event ID. V1 defines no separate eligibility-input
fingerprint: Algorithm A performs only bounded inert selector validation pre-lock,
and every authority/security decision occurs after its lock.

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

PR1 has no authority columns, so producer/posting authority is intentionally not
invented inside `canonicalReceivableFingerprint`. The event hash seals the complete
producer composite, while the audit payload and `resultHash` below seal the complete
posting-adapter composite. This is the exact selected downstream design.

`auditPayloadFingerprint` uses domain
`rentcore.canonical_actual_posting.audit_payload`, version `1`, and exactly:

```text
{ acceptedDryRunsHash, acceptedPr8EvidenceHash, activationRecordId,
  actorAuthorityRecordId, actorIdentityId, canonicalReceivableFingerprint, domain,
  dueDatePolicySetHash,
  dueDateTreatment, economicLineageKey, economicSourceRevisionKey, eventHash,
  eventId, operationId, postingAdapterAuthorityBranchId,
  postingAdapterAuthorityCompanyId, postingAdapterAuthorityKind,
  postingAdapterAuthorityRecordHash, postingAdapterAuthorityRecordId,
  postingAdapterAuthorityVersion, sourceAdapterAuthorityRecordHash,
  sourceAdapterAuthorityRecordId, sourceAdapterAuthorityVersion,
  selectedDueDateGateKind, selectedDueDatePolicyHash,
  selectedDueDatePolicyId, selectedDueDatePolicyVersion, sourceLineageHash,
  sourceOwnershipManifestHash, unknownDueDateTreatmentMappingHash,
  unknownDueDateTreatmentMappingId, unknownDueDateTreatmentMappingVersion,
  version, writeAuthorizationRecordId }
```

The repository stores `newValueJson` as a canonical object with exactly every field
above except `domain`/`version`, plus exactly `auditPayloadFingerprint`; no caller
JSON or additional key is accepted. The exact repository-derived
`financial_audit_events` row mapping is:

| Persisted column | Exact value |
|---|---|
| `id` | pre-generated repository `audit-` UUID; equals operation `financialAuditEventId` |
| `companyId`, `branchId` | exact event/operation scope |
| `aggregateType` | literal `canonical_receivable` |
| `aggregateId` | exact `canonicalReceivableId` |
| `eventType` | literal `canonical_receivable.initial_posted.v1` |
| `actorId` | literal `integration:rentcore-canonical-receivable-posting` |
| `actorType` | literal `integration` |
| `occurredAt` | exact locked `attemptedAt` |
| `reason` | literal `canonical_actual_posting_initial_post_v1` |
| `previousValueJson` | SQL/JSON null; `{}`, `[]` and string `"null"` are forbidden |
| `newValueJson` | exact canonical payload object defined above |
| `correlationId` | exact event/operation correlation ID |
| `sourceSystem` | literal `rentcore.billing_source_authority.v1` |
| `createdAt` | exact locked `attemptedAt`, equal to `occurredAt` |

Inside `newValueJson`, `actorIdentityId` equals the exact audit `actorId`, and
`actorAuthorityRecordId` equals the locked posting-adapter `authorityRecordId`; both are
repository-derived and bound by the operation. They are distinct exact payload keys
in addition to `postingAdapterAuthorityRecordId`, and the two authority IDs must be
equal. Version/hash/company/branch/kind are the exact locked composite and are
verified through the payload fingerprint.
The deferred FK seals audit ID/company/branch; the audit-side `AFTER
INSERT` trigger compares every table row value, payload key and fingerprint after
both rows exist. Null/empty substitution, an unknown/additional payload key or any
one-field mismatch aborts.

`auditEventFingerprint` uses domain
`rentcore.canonical_actual_posting.financial_audit_event`, version `1`, and exactly:

```text
{ actorId, actorType, aggregateId, aggregateType, auditPayloadFingerprint,
  branchId, companyId, correlationId, createdAt, domain, eventType, id,
  occurredAt, previousValueJson, reason, sourceSystem, version }
```

This projection represents `newValueJson` only by its separately verified
`auditPayloadFingerprint`; every other persisted audit field is listed. There are no
other exclusions. `occurredAt = createdAt = attemptedAt`, `previousValueJson` is
JSON null, and every fixed literal is included in the fingerprint rather than
inferred by the verifier.

`resultHash` uses domain `rentcore.canonical_actual_posting.result`, version `1`,
and exactly:

```text
{ acceptedDryRunsHash, acceptedPr8EvidenceHash, activationId,
  activationRecordHash, activationRecordId,
  attemptedAt, auditEventFingerprint, auditPayloadFingerprint, branchId,
  canonicalReceivableFingerprint, canonicalReceivableId, commandFingerprint,
  canonicalWriteAuthorizationId, companyId, correlationId, domain,
  currentPr6RevisionHash, dueDatePolicySetHash, dueDateTreatment,
  economicLineageKey, economicSourceRevisionKey,
  eventHash, eventId, financialAuditEventId, freshnessWindowFingerprint,
  idempotencyKey, operationId, operationType,
  postingAdapterAuthorityBranchId, postingAdapterAuthorityCompanyId,
  postingAdapterAuthorityKind, postingAdapterAuthorityRecordHash,
  postingAdapterAuthorityRecordId, postingAdapterAuthorityVersion, schemaVersion,
  producerAuthorityBranchId, producerAuthorityCompanyId, producerAuthorityKind,
  producerAuthorityRecordHash, producerAuthorityRecordId,
  producerAuthorityVersion,
  selectedDueDateGateKind, selectedDueDatePolicyHash, selectedDueDatePolicyId,
  selectedDueDatePolicyVersion,
  sourceAdapterAuthorityRecordHash, sourceAdapterAuthorityRecordId,
  sourceAdapterAuthorityVersion, sourceLineageHash,
  sourceOwnershipManifestHash, unknownDueDateTreatmentMappingHash,
  unknownDueDateTreatmentMappingId, unknownDueDateTreatmentMappingVersion, version,
  writeAuthorizationRecordHash, writeAuthorizationRecordId }
```

`CanonicalPostingOperationV1` identity is company + operation type + idempotency
key. Every operation column is present; the unknown-mapping triple follows the exact
conditional null rule for the selected due-date gate. `resultHash` excludes exactly itself; all
other projections above are reread and recomputed before commit. `resultHash` is the
operation's immutable seal hash; this is the operation hash for the posting chain.
Its literal source-adapter and posting-adapter composites plus the event-sealed
producer composite satisfy the required authority binding without introducing a
second ambiguous operation hash.
Within that envelope, `attemptedAt` equals the persisted operation `createdAt`; for
a new result both equal the one locked clock value, while replay reuses that sealed
persisted value rather than the new attempt clock. Authority and activation record
hash members, logical `activationId`/`canonicalWriteAuthorizationId`, acceptance
hash, due-date policy set, selected gate and optional mapping are obtained from the
exact relational parents/event/operation during persisted reread, never from command
assertions.

### 22.8 `CanonicalPostingConflictV1`

`ConflictObservationV1` is a repository-owned plain object with exactly:

```text
{ domain, version, conflictType, expectedProjection, observedProjection }
```

`domain = rentcore.canonical_actual_posting.conflict_observation`, `version = 1`,
and `conflictType` must be one exact section-22.8 registry literal. The repository persists
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

`economicLineageCandidateFingerprint` is available before a unique coverage root is
accepted. It uses domain
`rentcore.canonical_actual_posting.economic_lineage_candidate`, version `1`, and
exactly `{branchId,companyId,contractId,coverageEndExclusive,coverageStart,currency,
domain,economicRowClass,rentalId,rentalLineId,sourceSystem,version}`. It intentionally
contains neither root source-document nor root coverage ID: disconnected roots with
the same apparent economic dimensions must collide before either root can become an
accepted lineage. It contains no amount, due date, name or authority data.
On the observed side of `SOURCE_LINEAGE_ROOT_CONFLICT`,
`rootCoverageLineageIdsHash` uses domain
`rentcore.canonical_actual_posting.root_lineage_ids`, version `1`, and exactly
`{domain,rootCoverageLineageIds,version}`; `rootCoverageLineageIds` is the complete
unique array of candidate root IDs sorted by the section-22.1 comparator, including
the empty array when no root exists. `rootSourceDocumentLineageIdsHash` uses domain
`rentcore.canonical_actual_posting.root_source_document_lineage_ids`, version `1`,
and exactly `{domain,rootSourceDocumentLineageIds,version}` with the complete unique
root UPD-ID array under the same sorting/empty-array rule. `currentRevisionKeysHash` uses domain
`rentcore.canonical_actual_posting.current_revision_keys`, version `1`, and exactly
`{currentSourceRevisionKeys,domain,version}`; `currentSourceRevisionKeys` is the
complete unique array of locked current revision keys sorted by the same comparator.
It has length zero for `missing`, one for `unique` and greater than one for `multiple`.
The exact empty-array canonical bytes are
`{"currentSourceRevisionKeys":[],"domain":"rentcore.canonical_actual_posting.current_revision_keys","version":1}`
and their lowercase SHA-256 is
`4d53a13d442698681189cedda090011c7b09d8ee523444f7ebde5e0a0ae43d0f`.
On the expected side of every invalid-cardinality conflict,
`currentRevisionKeysHash` is exact JSON null: it expresses the invariant “cardinality
must be one” without inventing a unique revision. The root-conflict expected-side
root hashes are likewise exact JSON null. Null is a registered value here, not
missing evidence. A caller-selected candidate, first sorted member, generated
sentinel ID or pre-lock selector must never populate an expected hash.
`replacementRelationHash` uses domain
`rentcore.canonical_actual_posting.replacement_relation`, version `1`, and exactly
`{domain,economicLineageCandidateFingerprint,relations,version}` where `relations`
is the complete locked correction/supersession path ordered by predecessor set ID,
replacement set ID, then lifecycle action, with exact objects
`{action,predecessorCoverageSetId,replacementCoverageSetId,supersessionRowHash}`.
`predecessorCoverageSetId` is the exact projection alias of persisted
`originalCoverageSetId`; `supersessionRowHash` is that row's section-22.4
`rowFingerprint`. All three ordering members use the section-22.1 comparator.
Missing, extra, duplicate, cyclic or cross-scope relations reject before hashing.

`BrokenSuccessorEdgeFingerprintV1` uses domain
`rentcore.canonical_actual_posting.broken_successor_edge`, version `1`, and exactly:

```text
{ branchId, companyId, domain, edgeFailureState, fromCoverageSetId,
  relationRowFingerprint, rootCoverageLineageId, toCoverageSetId, version }
```

The edge failure state is exactly `missing_successor`, `scope_mismatch` or
`root_mismatch`. `fromCoverageSetId` and `toCoverageSetId` are validated opaque IDs
from the exact persisted successor relation; `relationRowFingerprint` is that row's
section-22.4 fingerprint. `brokenEdgesHash` uses domain
`rentcore.canonical_actual_posting.broken_successor_edges`, version `1`, and exactly
`{brokenEdges,domain,version}`. `brokenEdges` is the complete non-empty unique array
of exact objects
`{brokenEdgeFingerprint,edgeFailureState,fromCoverageSetId,toCoverageSetId}` sorted by
from ID, to ID, failure state and fingerprint using the section-22.1 comparator.
Duplicate edges reject. The expected empty set uses the same envelope with
`brokenEdges=[]`; its exact canonical bytes are
`{"brokenEdges":[],"domain":"rentcore.canonical_actual_posting.broken_successor_edges","version":1}`
and its lowercase SHA-256 is
`97b4e7f01727cf1eae759041089aedc1f3e8a1b149d4b922b86375364edecce0`.
Projection keys `brokenEdgeFromId` and `brokenEdgeToId` are exact aliases of the sole
edge's `fromCoverageSetId` and `toCoverageSetId`, and `brokenEdgeFingerprint` is its
exact edge fingerprint; all three are JSON null when count is zero or greater than
one. Projection `companyId`, `branchId` and `rootCoverageLineageId` are always the
validated attempt scope and accepted root, never values copied from an invalid target.

Every non-authority expected and observed projection below additionally has the
same exact common authority-binding keys
`{postingAdapterAuthorityBranchId,postingAdapterAuthorityCompanyId,
postingAdapterAuthorityKind,postingAdapterAuthorityRecordHash,
postingAdapterAuthorityRecordId,postingAdapterAuthorityVersion,
producerAuthorityBranchId,producerAuthorityCompanyId,producerAuthorityKind,
producerAuthorityRecordHash,producerAuthorityRecordId,producerAuthorityVersion}`.
Expected values come from the exact authorization/activation/event bindings;
observed values come from the locked latest-chain reread. Every member is non-null
and byte-exact for a persistable non-authority conflict; otherwise the applicable
higher-precedence authority denial is selected. Thus the table lists the complete
type-specific keys, not an alternative to this mandatory common projection.

The sixteen exact non-authority projection types are:

| `conflictType` | Exact type-specific keys in both projections | Expected authoritative source | Observed authoritative source / null rule |
|---|---|---|---|
| `SOURCE_LINEAGE_ROOT_CONFLICT` | `{economicLineageCandidateFingerprint,rootCount,rootCoverageLineageIdsHash,rootObservationState,rootSourceDocumentLineageIdsHash}` | invariant projection: `rootObservationState=unique`, `rootCount=1`, both root hashes are JSON null | complete locked predecessor traversal; `rootObservationState` follows the exact precedence below, count is the complete candidate-root count, and both sorted-root hashes are non-null even for the empty arrays |
| `SOURCE_LINEAGE_BROKEN_SUCCESSOR` | `{branchId,brokenEdgeCount,brokenEdgeFingerprint,brokenEdgesHash,brokenEdgeFromId,brokenEdgeToId,companyId,economicLineageCandidateFingerprint,rootCoverageLineageId,successorObservationState}` | invariant projection: exact attempt scope/root/candidate, `successorObservationState=complete`, `brokenEdgeCount=0`, singular edge aliases are JSON null and `brokenEdgesHash` seals the registered empty array | complete locked successor scan; `successorObservationState=broken`, count is positive and hash seals every sorted broken edge; for count one the singular aliases equal that edge, and for count greater than one all three singular aliases are JSON null |
| `SOURCE_LINEAGE_NO_CURRENT_REVISION` | `{currentRevisionCount,currentRevisionKey,currentRevisionKeysHash,currentRevisionState,economicLineageKey,rootCoverageLineageId}` | invariant projection: `currentRevisionState=unique`, `currentRevisionCount=1`, `currentRevisionKey` and `currentRevisionKeysHash` are JSON null | complete locked active-revision scan for the accepted root; `currentRevisionState=missing`, count is `0`, `currentRevisionKey` is JSON null and `currentRevisionKeysHash` is the registered exact empty-array hash |
| `SOURCE_LINEAGE_MULTIPLE_CURRENT_REVISIONS` | `{currentRevisionCount,currentRevisionKey,currentRevisionKeysHash,currentRevisionState,economicLineageKey,rootCoverageLineageId}` | invariant projection: `currentRevisionState=unique`, `currentRevisionCount=1`, `currentRevisionKey` and `currentRevisionKeysHash` are JSON null | complete locked active-revision scan for the accepted root; `currentRevisionState=multiple`, count is greater than `1`, `currentRevisionKey` is JSON null and the hash seals the complete sorted non-empty key array |
| `SOURCE_CORRECTION_AFTER_POSTING` | `{canonicalReceivableId,currentSourceRevisionKey,economicLineageKey,eventId,eventSourceRevisionKey,replacementRelationHash}` | operation/event-sealed revision | locked current successor revision after an existing canonical row; no member is nullable |
| `SOURCE_CORRECTION_AFTER_ELIGIBILITY` | `{currentSourceRevisionKey,economicLineageKey,eventId,eventSourceRevisionKey,replacementRelationHash}` | event-sealed revision | locked unique current successor after an event and before canonical posting; no member is nullable |
| `SOURCE_REVISION_CHANGED_BEFORE_POSTING` | `{currentPr6RevisionHash,currentSourceRevisionKey,economicLineageKey,eventId,sealedPr6RevisionHash,sealedSourceRevisionKey}` | event-sealed current revision | same revision IDs without a valid correction edge but changed locked PR6 revision hash |
| `ECONOMIC_SOURCE_EVENT_MISMATCH` | `{economicLineageKey,economicSourceRevisionKey,eventHash,eventId}` | locked attempted event reconstruction | persisted event at the lineage/revision/candidate identity; `eventId` is null only when no row exists |
| `PR6_LINEAGE_DRIFT` | `{sourceLineageHash}` | event-sealed PR6 lineage | complete locked current 16-table PR6 reconstruction |
| `PR8_EVIDENCE_MISMATCH` | `{acceptedDryRunsHash,acceptedPr8EvidenceHash,dryRunId,freshnessState,freshnessWindowFingerprint,reconciliationSetHash,resultHash}` | authorization/activation acceptance and selected run with `freshnessState=fresh` | complete locked PR8 graph and half-open clock evaluation; state is `fresh`, `stale`, `not_yet_valid` or `invalid_window`; other members are null only when their exact persisted source is absent |
| `DUE_DATE_POLICY_DRIFT` | `{bindingState,dueDatePolicySetHash,dueDateTreatment,selectedDueDateGateKind,selectedDueDatePolicyHash,selectedDueDatePolicyId,selectedDueDatePolicyVersion,unknownDueDateTreatmentMappingHash,unknownDueDateTreatmentMappingId,unknownDueDateTreatmentMappingVersion}` | event/authorization/activation selected member with `bindingState=valid` | locked selected named PR8 gate and mapping; state is `valid`, `missing` or `ambiguous`; all policy/mapping members are null for missing/ambiguous, and mapping members are null for a valid proven gate |
| `COMPANY_TIMEZONE_DRIFT` | `{acceptedCompanyTimezoneSnapshot,activationCompanyTimezoneSnapshot,eventCompanyTimezoneSnapshot,pr5ReceivablesTimezone,pr8RunCompanyTimezone,timezoneState}` | five-way accepted/event/activation/run/PR5 equality with `timezoneState=valid` | locked values; state is `valid`, `missing`, `invalid`, `unavailable`, `ambiguous` or `mismatch`; each unavailable source is null and no alias is normalized |
| `AUTHORIZATION_DRIFT` | `{authorizationId,authorizationTemporalState,authorizationVersion,recordHash,status,temporalWindowFingerprint,validFrom,validUntil}` | event-bound authorization expected `authorized` and `authorizationTemporalState=active` | latest locked authorization record plus attemptedAt evaluation; temporal state is `active`, `not_yet_effective` or `expired` |
| `ACTIVATION_DRIFT` | `{activationId,activationTemporalState,activationVersion,recordHash,status,temporalWindowFingerprint,validFrom,validUntil}` | event-bound activation expected `authorized` and `activationTemporalState=active` | latest locked activation record plus attemptedAt evaluation; temporal state is `active`, `not_yet_effective` or `expired` |
| `IDEMPOTENCY_CONTENT_CONFLICT` | `{activationId,canonicalWriteAuthorizationId,economicLineageKey,economicSourceRevisionKey,eventHash,idempotencyKey,operationType}` | locked attempted operation projection | persisted operation at any colliding lineage/revision/idempotency identity |
| `AUDIT_SEAL_MISMATCH` | `{actorAuthorityRecordId,actorIdentityId,aggregateId,auditEventFingerprint,auditEventId,auditPayloadFingerprint,branchId,companyId,correlationId,eventTypeFingerprint,eventTypeState}` | repository prospective audit seal with `eventTypeState=exact` | persisted audit/operation reconstruction; state is `exact`, `mismatch` or `missing`, and every other key is null only when the audit row is wholly absent |

For source-revision projections, `currentSourceRevisionKey` is the exact
`economicSourceRevisionKey` reconstructed from the locked current PR6 revision;
`eventSourceRevisionKey` and `sealedSourceRevisionKey` are aliases of the persisted
event's `economicSourceRevisionKey`; `currentPr6RevisionHash` is the locked current
seal and `sealedPr6RevisionHash` is the persisted event seal. These aliases add no
caller-controlled or implicit field.

The root observation enum is exactly `unique`, `cycle`, `broken_predecessor`,
`ambiguous_predecessor`, `cross_lineage_collision`, `missing_root` or
`multiple_roots`. Expected is always `unique`. When several safely reconstructable
defects coexist, observed selection is the first applicable literal in this exact
order: `cycle`, `broken_predecessor`, `ambiguous_predecessor`,
`cross_lineage_collision`, `missing_root`, `multiple_roots`. Cross-scope or
unreadable corruption remains `not allowed` and never reaches Algorithm C.
`cycle` means a coverage-set ID repeats during the complete predecessor/successor
walk; `broken_predecessor` means a named same-scope predecessor relation cannot be
joined to its required set/slice projection; `ambiguous_predecessor` means more than
one relation names the same replacement; `cross_lineage_collision` means a linked
replacement changes any section-22.5 lineage-defining member; `missing_root` means
the safely readable candidate graph has zero root after the preceding conditions are
false; and `multiple_roots` means it has more than one. A normal no-predecessor row is
the unique root and is never `broken_predecessor`.
`currentRevisionState` is exactly `missing`, `unique` or `multiple` and is derived
only from the complete locked sorted `currentRevisionKeys` array: count zero is
`missing`, count one is `unique`, and a greater count is `multiple`.
`currentRevisionKey` is the sole array member only for a normal non-conflicting
`unique` runtime state; it is JSON null for `missing`/`multiple` observations and for
the invariant expected side of both cardinality conflicts. The root conflict and the
two current-cardinality types are the only section-22.8 types whose expected set-hash
member is JSON null. Their observed set hashes are always non-null, including the
registered empty-root and empty-current hashes. Consequently two implementations
cannot choose different roots, revisions or sentinels merely to construct the
expected side.

The exact current-revision state matrix is:

| State | Count / sorted keys / hash | Expected and observed projection | Precedence and transition | Retry |
|---|---|---|---|---|
| `missing` | `0`; `[]`; the registered non-null empty-envelope hash above | expected is exactly `unique`, count `1`, singular key and set hash JSON null; observed is exactly `missing`, count `0`, singular key JSON null and the empty-envelope hash, with the same accepted root and economic lineage key on both sides | after root and broken-successor checks and before `multiple`; `SOURCE_LINEAGE_NO_CURRENT_REVISION`; A/B deny, C is required when safely reconstructable and otherwise takes the exact not-allowed path below | the same locked graph reproduces identical side fingerprints, observation hash and conflict hash, so the unique conflict row deduplicates |
| `unique` | `1`; `[currentRevisionKey]`; non-null hash of the registered envelope | the normal runtime invariant and observation are both `unique`, count `1`, the sole non-null key and its non-null set hash; no conflict projection is constructed | after all prior lineage checks, A/B may derive the current PR6 revision seal and proceed; no conflict type and C is not invoked | ordinary event/posting replay rules apply; the state itself creates no evidence row |
| `multiple` | greater than `1`; complete unique comparator-sorted key array; its non-null registered envelope hash | expected is exactly `unique`, count `1`, singular key and set hash JSON null; observed is exactly `multiple`, actual count, singular key JSON null and complete set hash, with the same accepted root and economic lineage key on both sides | after `missing`; `SOURCE_LINEAGE_MULTIPLE_CURRENT_REVISIONS`; A/B deny and C is required | the same locked set reproduces identical side fingerprints, observation hash and conflict hash; input row order cannot change dedupe |

For both conflict states, each side fingerprint, `conflictObservationHash` and
`conflictHash` is computed by the exact section-22.8 envelopes; no raw repository
ordering, selected candidate or timestamp enters them.

`SOURCE_LINEAGE_BROKEN_SUCCESSOR` is persistable only when the attempt scope, unique
root, exact relation row, validated from/to IDs and complete broken-edge set are all
safely reconstructable. Cross-scope and root-mismatch observations project only the
attempt company/branch and opaque edge/root IDs; no target-tenant data, business
labels, amounts, dates, reasons or payloads are retained. If an ID/relation hash is
invalid, the edge set is ambiguous/unreadable, or safe projection would require
untrusted/cross-tenant content, Algorithm C is exactly `not allowed`, opens the P0
telemetry circuit and returns
`CANONICAL_POSTING_UNSAFE_BROKEN_SUCCESSOR_EVIDENCE`. No conflict row is attempted.
PR9a must publish exact approved-JavaScript and independent-reference canonical-byte/
SHA-256 fixtures for the empty and populated current-revision envelopes, every broken
edge state, one and multiple sorted edges, both side projections, the full
`ConflictObservationV1` and final `conflictHash`.

The seven source-lineage/revision transitions are exact:

| Type | Algorithm A/B transition | Algorithm C persistence | Circuit |
|---|---|---|---|
| `SOURCE_LINEAGE_ROOT_CONFLICT` | A and B stop on zero/multiple roots, cycle, broken/ambiguous predecessor, same-scope cross-lineage replacement or disconnected roots with the same candidate fingerprint; they use the registered invariant expected projection and exact observed-state precedence, never a selected root/sentinel | required when the same-scope graph and candidate/root-set fingerprints are reconstructable; unsafe cross-scope/unreadable corruption is `not allowed` | immediate |
| `SOURCE_LINEAGE_BROKEN_SUCCESSOR` | after one root is accepted, A and B stop when any persisted successor reference is missing, cross-scope or resolves to another lineage root; complete edges are sorted before any denial hash | required for the safely reconstructable projection above; otherwise exactly `not allowed` with `CANONICAL_POSTING_UNSAFE_BROKEN_SUCCESSOR_EVIDENCE` | immediate |
| `SOURCE_LINEAGE_NO_CURRENT_REVISION` | A and B stop when the accepted root has zero active current revisions; expected key/hash are null and observed hash seals the exact empty array | required when the root and empty active set are safely reconstructable; otherwise the existing unsafe/unreadable `not allowed` rule applies | immediate |
| `SOURCE_LINEAGE_MULTIPLE_CURRENT_REVISIONS` | A and B stop when one root has more than one active current revision; expected key/hash are null and observed hash seals the complete sorted set | required | immediate |
| `SOURCE_CORRECTION_AFTER_POSTING` | A or B finds a canonical/operation anywhere in the root graph and a different current revision | required | immediate |
| `SOURCE_CORRECTION_AFTER_ELIGIBILITY` | A or B finds an event in the root graph and a different successor revision, with no canonical row | required | immediate |
| `SOURCE_REVISION_CHANGED_BEFORE_POSTING` | A or B finds the same revision IDs but a different `currentPr6RevisionHash` without a valid replacement edge | required | immediate |

For every required transition A/B rolls back with zero additional event/canonical/
operation/audit rows and passes only the branded descriptor to C. `conflictHash`
deduplicates the exact projections; no raw attempt timestamp participates.
The exact source-lineage precedence is root conflict first (using its internal
`cycle` through `multiple_roots` order), then broken successor, no current revision,
multiple current revisions, correction after posting, correction after eligibility
and revision changed before posting. Therefore cycle or competing roots beat a broken
successor; a safely reconstructed broken successor beats either current-cardinality
conflict. Same locked state yields the same fingerprints/hash on retry. Missing versus
multiple current states and every broken-edge/root state differ in their exact state,
count and/or sorted set hash and cannot deduplicate into one another.

The authority-denial registry is the exact Cartesian product of these prefixes and
suffixes; the literal conflict type is `<PREFIX>_<SUFFIX>`:

```text
PREFIX = SOURCE_ADAPTER | ELIGIBILITY_PRODUCER | CANONICAL_POSTING_ADAPTER
SUFFIX = NOT_YET_EFFECTIVE | EXPIRED | REVOKED | SUPERSEDED |
         RECORD_HASH_MISMATCH | ARTIFACT_IDENTITY_DRIFT |
         CONFIGURATION_HASH_DRIFT | POLICY_HASH_DRIFT | SCOPE_MISMATCH |
         OWNERSHIP_MANIFEST_MISMATCH | LATEST_CHAIN_MISMATCH
```

These 33 literals are all registered; there is no untyped authority denial. Every
one uses `AuthorityDenialObservationV1` with exact projection keys:

```text
{ actorId, artifactIdentityHash, authorityId, authorityKind, authorityRecordId,
  authorityVersion,
  bindingState, configurationHash, latestRecordHash, ownershipManifestHash,
  effectiveFrom, effectiveUntil, policyHash, recordHash, scopeFingerprint, stateCode,
  status, temporalEvaluationState, temporalWindowFingerprint }
```

For each literal, `expectedFingerprint` and `observedFingerprint` use the two exact
side-fingerprint envelopes above over this complete projection, and `conflictHash`
below is the deduplication key. The prefix fixes `authorityKind`; the suffix fixes
`stateCode`, precedence and the persistence/circuit transition. Consequently there
is no generic or caller-selected fingerprint, dedupe key or Algorithm-C policy for
an authority denial.

`stateCode` is the suffix, `authorityKind` is the kind selected by the prefix, and
`bindingState` is `valid`, `missing` or `ambiguous`. `artifactIdentityHash` seals
exact artifact digest plus commit SHA; `scopeFingerprint` seals company/branch;
`temporalWindowFingerprint` uses domain
`rentcore.canonical_actual_posting.temporal_window`, version `1`, and exactly
`{domain,effectiveFrom,effectiveUntil,recordHash,recordId,recordKind,version}`.
`recordKind` is exactly `governed_authority`, `write_authorization` or `activation`;
`recordId`/`recordHash` are the locked persisted record's physical ID and record hash.
`effectiveUntil` is the exact projection alias of persisted `expiresAt`.
`temporalEvaluationState` is exactly `active`, `not_yet_effective` or `expired`:
expected is always `active`; observed is derived only from the locked `attemptedAt`
and half-open interval. Raw attemptedAt is excluded, so retries in the same temporal
state deduplicate. The exact window timestamps remain sealed and stable. No raw artifact,
cross-tenant scope or reason text is retained. Expected projection comes from the
authorization-bound exact record and expects `authorized`, current, same scope and
matching artifact/config/policy/ownership. Observed projection comes from the locked
latest-chain/record/PR6 reconstruction. A missing/ambiguous observed record uses null
for every unavailable record-derived member; omission is forbidden.

Exact authority suffix behavior is:

| Suffix | Deterministic observed condition | Algorithm C persistence | Circuit |
|---|---|---|---|
| `NOT_YET_EFFECTIVE` | observed parent is the exact attempt-bound record and `attemptedAt < effectiveFrom` | required when exact same-scope record/FKs remain valid | immediate |
| `EXPIRED` | observed parent is the exact attempt-bound record and `attemptedAt >= expiresAt`; a later record whose persisted status is `expired` is not substituted for this same-record temporal denial | required when exact same-scope record/FKs remain valid | immediate |
| `REVOKED` | observed parent is the exact attempt-bound record already marked `revoked`, or the unique contiguous latest terminal descendant of the same logical chain with status `revoked` | required | immediate |
| `SUPERSEDED` | observed parent is the unique contiguous latest descendant of the same logical chain with status `superseded` | required | immediate |
| `RECORD_HASH_MISMATCH` | same scope/kind/logical authority ID, physical record ID and version; persisted parent remains FK-bindable but locked envelope reconstruction differs from the attempt-bound/persisted hash | required when the persisted exact parent key remains relationally bindable; otherwise not allowed | immediate |
| `ARTIFACT_IDENTITY_DRIFT` | exact attempt-bound record/version and logical chain; locked registered artifact digest or commit projection differs | required | immediate |
| `CONFIGURATION_HASH_DRIFT` | exact attempt-bound record/version and logical chain; locked registered configuration projection differs | required | immediate |
| `POLICY_HASH_DRIFT` | exact attempt-bound record/version and logical chain; locked registered policy projection differs | required | immediate |
| `SCOPE_MISMATCH` | company/branch scope differs | not allowed because a cross-scope parent FK must never be created | immediate telemetry |
| `OWNERSHIP_MANIFEST_MISMATCH` | exact attempt-bound record/version and logical chain; authorization-bound ownership hash differs from complete PR6 reconstruction | required | immediate |
| `LATEST_CHAIN_MISMATCH` | observed parent is the exact repository-latest contiguous descendant with the same company/branch/kind/logical authority ID; it is currently `authorized`, otherwise the applicable lifecycle suffix wins | required when both bound and unique latest records are safely reconstructable; otherwise not allowed | immediate telemetry |

“Required” means A/B roll back primary effects and then invoke Algorithm C. “Not
allowed” means no conflict row is attempted: the denial remains final, the P0
telemetry circuit opens, and success is impossible. This is not optional persistence.
For authority conflicts that are persisted, the conflict row's nullable
`deniedAuthorityKind`/record ID/version/hash must bind the exact same-scope denied
authority parent; all four are null for non-authority conflicts and all four are
non-null for authority conflicts. Deduplication uses the normal `conflictHash`; every
authority type is immediate-circuit severity `p0`.

Same record means byte-identical physical ID, logical authority ID, version and
persisted hash. Contiguous descendant means following only exact N-to-N+1
`previousRecordId` links inside one company/branch/kind/logical-authority-ID chain;
no skipped version or actor-adjacent chain is accepted. For a reconstructed
`RECORD_HASH_MISMATCH`, the observed projection's `recordHash` is the recomputed hash,
while `deniedAuthorityRecordHash` remains the bindable persisted parent hash. For
artifact/configuration/policy/ownership drift the observed projection retains the
same attempt record identity/version and changes only the registered derived member(s)
and resulting fingerprints. These rules make every persistable terminal, temporal,
hash and latest-chain denial relationally distinct without weakening the parent FK.

For every persisted authority conflict, the source/producer/posting composites in the
top-level conflict row remain the exact immutable attempt-bound records selected by
the denied write authorization: source and producer equal its bindings, posting
equals its and the activation's common binding, and any referenced event/operation
must agree. They are evidence references, not a new current-authority decision. The
`deniedAuthority*` composite names the exact observed persisted parent selected by
`AuthorityDenialObservationV1`: the locked record whose lifecycle,
temporal, content or chain relation establishes the selected prefix/suffix. For
`LATEST_CHAIN_MISMATCH` and later-version `SUPERSEDED`, this is the safely
reconstructable unique latest record; for a denial established by the bound record
itself, it may equal that attempt-bound parent. If no unique same-chain observed record
can supply all four fields and satisfy the suffix relation, the registry's
conditional/`not allowed` rule applies and
no conflict row is inserted. Algorithm C and its triggers must never replace an
attempt-bound top-level composite with this observed composite.

Projection keys use section-22.1 ordering. No other field is allowed. Non-null IDs
are validated opaque IDs, versions are positive safe integers, statuses/types/states
are exact enums, a non-null timezone is a canonical IANA name and fingerprints are
lowercase SHA-256. JSON null is permitted only by the rules above; omission is
forbidden. Invalid/unavailable raw timezone or policy content is never retained.
Projections contain no names, contacts, addresses, amounts, business dates,
free-form reasons, credentials, tokens, source payloads or arbitrary caller JSON.

For write authorization and activation, projection aliases `validFrom` and
`validUntil` are the persisted `effectiveFrom` and exclusive `expiresAt`; their
`temporalWindowFingerprint` uses record kinds `write_authorization` and `activation`.
The expected state is active and the observed state follows the same half-open
comparison. Thus unchanged ID/hash/status plus a time-only denial still yields
different side fingerprints. For PR8, `freshnessState` is derived as
`not_yet_valid` when `attemptedAt < validFrom`, `fresh` when
`validFrom <= attemptedAt < validUntilExclusive`, `stale` at or after the exclusive
end, and `invalid_window` on invalid/overflow/mismatched window data. The raw clock
value is absent from all conflict and dedupe hashes. When the accepted entry remains
structurally valid, both sides project its exact persisted
`freshnessWindowFingerprint`; the side fingerprints still differ because the
expected state is `fresh` and the observed state is the locked evaluation result.
`invalid_window` represents a current PR8 finalized-time/window reconstruction that
cannot reproduce that accepted window. If the acceptance entry/fingerprint itself
is missing or cannot pass its exact hash/type checks, safe conflict reconstruction
is impossible: Algorithm C rolls back evidence persistence and opens the circuit.

Projection timestamps are limited to these immutable authority/freshness window
members. No source business date is retained. For the audit projection,
`eventTypeFingerprint` is SHA-256 of exactly
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
for PREFIX in [SOURCE_ADAPTER, ELIGIBILITY_PRODUCER,
               CANONICAL_POSTING_ADAPTER]:
  PREFIX_SCOPE_MISMATCH
  PREFIX_RECORD_HASH_MISMATCH
  PREFIX_REVOKED
  PREFIX_SUPERSEDED
  PREFIX_EXPIRED
  PREFIX_NOT_YET_EFFECTIVE
  PREFIX_ARTIFACT_IDENTITY_DRIFT
  PREFIX_CONFIGURATION_HASH_DRIFT
  PREFIX_POLICY_HASH_DRIFT
  PREFIX_OWNERSHIP_MANIFEST_MISMATCH
  PREFIX_LATEST_CHAIN_MISMATCH
AUTHORIZATION_DRIFT
ACTIVATION_DRIFT
SOURCE_LINEAGE_ROOT_CONFLICT
SOURCE_LINEAGE_BROKEN_SUCCESSOR
SOURCE_LINEAGE_NO_CURRENT_REVISION
SOURCE_LINEAGE_MULTIPLE_CURRENT_REVISIONS
SOURCE_CORRECTION_AFTER_POSTING
SOURCE_CORRECTION_AFTER_ELIGIBILITY
SOURCE_REVISION_CHANGED_BEFORE_POSTING
PR6_LINEAGE_DRIFT
PR8_EVIDENCE_MISMATCH
DUE_DATE_POLICY_DRIFT
COMPANY_TIMEZONE_DRIFT
IDEMPOTENCY_CONTENT_CONFLICT
AUDIT_SEAL_MISMATCH
ECONOMIC_SOURCE_EVENT_MISMATCH
```

No multi-row conflict fan-out or implementation-specific precedence is allowed.
Authority precedence is kind-major: every source-adapter denial precedes every
eligibility-producer denial, which precedes every canonical-posting-adapter denial.
Within one kind, unbindable scope wins first, then record-hash integrity, terminal
revoked/superseded/expired lifecycle, temporal expiry/not-yet state, artifact,
configuration, policy and ownership drift, and finally generic latest-chain mismatch.
A terminal latest descendant therefore selects its exact lifecycle literal rather
than being swallowed by `LATEST_CHAIN_MISMATCH`; that last suffix applies only when
the safely reconstructed latest descendant is otherwise authorized/active and no
more specific condition matched.
Immediate circuit-open types are all 33 authority types plus
the seven source-lineage/revision types, `ECONOMIC_SOURCE_EVENT_MISMATCH`,
`PR6_LINEAGE_DRIFT`, `PR8_EVIDENCE_MISMATCH`,
`DUE_DATE_POLICY_DRIFT`, `COMPANY_TIMEZONE_DRIFT`,
`IDEMPOTENCY_CONTENT_CONFLICT` and `AUDIT_SEAL_MISMATCH`.
`AUTHORIZATION_DRIFT` and `ACTIVATION_DRIFT` open the circuit on the fifth conflict
within five minutes per company/branch. Every type remains severity `p0`.

`conflictHash` uses domain `rentcore.canonical_actual_posting.conflict`, version
`1`, and exactly:

```text
{ acceptedDryRunsHash, acceptedPr8EvidenceHash, activationRecordHash,
  activationRecordId, branchId,
  companyId, conflictObservationHash, conflictType, detectorVersion, domain,
  deniedAuthorityKind, deniedAuthorityRecordHash, deniedAuthorityRecordId,
  deniedAuthorityVersion, economicLineageCandidateFingerprint,
  economicLineageKey, economicSourceRevisionKey, eventHash, eventId,
  existingOperationId, existingReceivableId, expectedFingerprint,
  observedFingerprint,
  postingAdapterAuthorityBranchId, postingAdapterAuthorityCompanyId,
  postingAdapterAuthorityKind, postingAdapterAuthorityRecordHash,
  postingAdapterAuthorityRecordId, postingAdapterAuthorityVersion,
  producerAuthorityBranchId, producerAuthorityCompanyId, producerAuthorityKind,
  producerAuthorityRecordHash, producerAuthorityRecordId,
  producerAuthorityVersion, schemaVersion,
  sourceAdapterAuthorityRecordHash, sourceAdapterAuthorityRecordId,
  sourceAdapterAuthorityVersion, sourceLineageHash,
  sourceOwnershipManifestHash, version,
  writeAuthorizationRecordHash, writeAuthorizationRecordId }
```

Generated `id`, `correlationId`, `detectedAt`, `createdAt`, `conflictHash`, and
severity (fixed `p0`) are the exact exclusions, so repeat detection deduplicates
despite a new attempt timestamp/correlation. Required nullable references are JSON
null when the row does not exist. `economicLineageKey` may be null only for
`SOURCE_LINEAGE_ROOT_CONFLICT`. `economicSourceRevisionKey` is JSON null for
`SOURCE_LINEAGE_ROOT_CONFLICT`, `SOURCE_LINEAGE_BROKEN_SUCCESSOR`,
`SOURCE_LINEAGE_NO_CURRENT_REVISION` and
`SOURCE_LINEAGE_MULTIPLE_CURRENT_REVISIONS`, because none has one accepted current
revision; it is non-null for every other conflict. `economicLineageCandidateFingerprint`
is always non-null. Denied-authority fields follow the exact
all-null/all-non-null authority registry rule. The parent record hashes are repository
values from the relational attempt-bound activation/producer/posting-authority/write-
authorization reread; the separate denied-authority identity comes from the exact
observed parent selected by the projection, while its stored hash remains the parent's
bindable persisted hash even for `RECORD_HASH_MISMATCH`. Neither is a caller field and the observed composite cannot
replace the attempt-bound composite. `conflictObservationJson` is represented only by its separately
verified `conflictObservationHash`; it is not hashed twice as raw JSON. Changed
semantic observation produces a new immutable conflict. PR9a fixtures publish exact
canonical bytes and SHA-256 for every projection row, both side envelopes, the full
observation and the resulting conflict hash.

### 22.9 Cross-contract field matrix

| Field/binding | Authoritative source | Persisted contracts | Hash envelopes | Locked reread | Replay/conflict role |
|---|---|---|---|---|---|
| `companyId`,`branchId` | PR5 relational scope | all six PR9 contracts + audit | every row/content hash | A, B and C reread composite parents | mismatch is conflict/denial, never cross-scope replay |
| scoped authority kind/logical-ID/record-ID/version/hash | repository-derived per-company/branch authority chains for source, producer and posting actors | authority; full source/producer/posting composites in authorization and their event/activation/operation consumers; immutable attempt-bound composites plus separate same-logical-chain observed denied-authority binding in conflict | authority/authorization/activation records, event, audit payload/event, result, conflict | A/B reconstruct all three chains and exact precedence; C preserves attempt-bound parents, proves suffix-specific contiguous observed relation, requires genuinely unaffected kinds active/latest and suppresses only safely reconstructed lower candidates | ID-only match is insufficient; cross-scope/kind/logical-chain, skipped-version or one-field drift denies; a conflict reference grants no current authority |
| `sourceOwnershipManifestHash` + upstream/row classes | complete PR6 ownership universe constrained by source adapter | authorization/event/operation/conflict; lineage rows | authorization record, source lineage, event, audit payload, result, conflict | A/B reconstruct all 16 tables; C verifies denial hashes | mismatch is the authority-kind `OWNERSHIP_MANIFEST_MISMATCH` type |
| accepted `{dryRunId,resultHash}` pairs + `acceptedPr8EvidenceHash` | signed acceptance record plus persisted PR8 result/reconciliation rows | authorization JSON/hashes/timezone/freshness window, activation/event/operation/conflict hashes | pair set, accepted-evidence/reconciliation/freshness hashes, authorization/activation/event/audit/result/conflict | A/B verify pair, exact row set, timezone and half-open freshness; C verifies denial binding | pair/timezone/reconciliation/freshness mix-and-match denies; exact set may replay |
| `AcceptedPr8EvidencePredicateV1` | locked PR8 run/candidate/seal plus all exact six-per-candidate reconciliation rows and accepted evidence | authorization, activation, event and operation acceptance bindings | accepted set/evidence/reconciliation hashes and downstream envelopes | A and B require the byte-identical predicate including each row's three zero deltas, diagnostic flag and both write flags | any false term denies; row netting and PR8 flag reinterpretation are forbidden |
| `economicLineageKey` + `economicSourceRevisionKey` | unique root UPD/coverage lineage plus exactly one current PR6 revision | event; lineage key in canonical `externalId`/`sourceLineId`; both in operation/conflict/audit subject to exact cardinality null rules | lineage root/candidate, broken-successor set, current-revision set, current PR6 revision, event, audit payload/event, result, conflict | A traverses roots/successors/current revisions and classifies broken successor, zero or multiple current before identity/write; B repeats the full scan; C reconstructs the registered safe observation or applies exact `not allowed` | latest replacement before first event is allowed; broken successor or zero/multiple current never creates an event/receivable; any different revision after event/posting conflicts and never duplicates |
| amount and due-date values | sealed PR6/PR8 source | event; mapped canonical row; operation/audit fingerprints | event, canonical, audit payload/event, result; conflict observations | A/B reconstruct under lock | excluded from economic lineage key; any change conflicts |
| due-date policy set/selected gate/mapping | accepted PR8 `contractual_due_date` and `unknown_due_date_treatment` named members plus repository mapping | authorization/activation set; selected member in event/operation/audit | policy set, event, command, audit, result and conflict observation | A/B reread both set members and only the provenance-selected gate; C reconstructs both sides | proven never depends on unknown; unknown never uses contractual; any source literal, gate or mapping drift conflicts |
| accepted/run/activation/event/PR5 timezone | persisted PR8 `run.companyTimezone`, signed acceptance snapshot, activation snapshot, event snapshot and fresh PR5 `receivablesTimezone` | authorization acceptance, activation, event, operation/audit via acceptance/event | accepted-evidence, authorization/activation/event, canonical/result and timezone conflict observation | A requires five-way equality and copies the accepted PR8 value; B repeats fresh equality before replay/write | null/invalid/alias/unavailable/change denies; no fresh-value substitution is allowed |
| cohort, boundary and idempotency identities | locked normalized activation/authorization/event parents | authorization, activation, event/operation | exact section 22.10 envelopes | A/B/C reconstruct logical arrays/IDs, never caller JSON/key | normalization drift denies; same lineage plus changed event/revision is conflict |
| `ConflictObservationV1` | branded repository denial plus locked reconstruction | conflict JSON and observation/side fingerprints | observation, expected, observed and conflict hashes | C reconstructs exact registered projections | same observation deduplicates; any semantic change is a new conflict |
| producer authority | latest eligibility-producer chain | full ID/version/hash/company/branch/kind composite in authorization and event; conflict stores the attempt-bound composite plus separate same-logical-chain observed denied composite | authority/authorization/event/result/conflict | A/B reconstruct exact producer candidate after source precedence; C proves same authority ID/contiguous suffix relation and source/posting active/latest unless they have a safely reconstructed precedence candidate | any one-field/latest-chain drift denies event/posting; selected terminal/latest-chain evidence remains persistable without masking a source denial |
| posting authority / audit actor authority | latest posting-adapter chain | full composite in authorization, activation, operation and audit payload; conflict stores the attempt-bound composite plus separate same-logical-chain observed denied composite | authority/authorization/activation, audit payload/event, result, conflict | B reconstructs posting only after source/producer precedence; C proves same authority ID/contiguous suffix relation and active/latest unaffected chains | any one-field mismatch denies; exact prior result may replay only while current; conflict evidence grants no replay authority |
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
and is sorted by the section-22.1 JCS string comparator before hashing. The hash never consumes the
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
than normalizes. `boundaryEndUtc` is SQL/JSON null for every forward-only v1 record
and the schema enforces `CHECK (boundaryEndUtc IS NULL)`. A non-null end is invalid,
not a later v1 option. Any bounded cohort requires a separately approved contract,
migration and boundary-envelope version; it cannot update or reinterpret v1. No
other null is allowed. Exact exclusions are cohort/policy/evidence
hashes, authorization/activation record or logical IDs and versions, status,
persisted `schemaVersion`, approval fields, `effectiveFrom`, `expiresAt`, revocation reason and timestamps:
activation expiry is a lifecycle gate, never source-boundary identity.

`CanonicalPostingIdempotencyKeyV1` computes `idempotencyKey` with domain
`rentcore.canonical_actual_posting.idempotency_key`, envelope version `1`, and
exactly:

```text
{ activationId, canonicalWriteAuthorizationId, domain, economicLineageKey,
  economicSourceRevisionKey, eventHash, operationType, version }
```

`activationId` is `canonical_posting_activation_records.activationId` and
`canonicalWriteAuthorizationId` is
`canonical_write_authorization_records.authorizationId`, both read from locked
relational parents; `operationType` is the exact initial-post literal. The
repository accepts no caller key and derives the value only after event,
authorization and activation reread. Attempt time, correlation, generated UUIDs,
record IDs, record/logical versions, persisted `schemaVersion`, authority status and
other mutable tags are exact exclusions. Same
inputs produce the same key. A changed revision under the same lineage is classified
by the correction/revision registry before idempotency. A changed `eventHash` under
the same lineage and same revision is `ECONOMIC_SOURCE_EVENT_MISMATCH` before any
new operation and can never create an independent receivable merely because its
derived idempotency key differs.

For all three contracts, section 5 and 22.1 byte rules apply. PR9a fixtures publish
the exact UTF-8 canonical JSON and lowercase SHA-256 for baseline, every single-field
mutation, array permutation, duplicate/empty-array rejection, null boundary end and
Unicode/escaping cases. Cross-implementation fixtures must match byte-for-byte.

## 23. Exact transaction algorithms

Before either primary transaction the repository may perform only bounded deeply
inert validation, copy selector/assertion strings and pre-generate candidate UUIDs
for rows that might be inserted. Algorithm B may additionally compute
`CanonicalPostingCommandFingerprintV1` because its event already exists; Algorithm A
does not compute that fingerprint or any substitute. Pre-lock work makes no authority,
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
2. reread the write-authorization record and its latest chain, canonical
   `acceptedPr8EvidenceJson`/hash, its exact projected
   `[{dryRunId,resultHash}]` pair set, accepted timezone, exact half-open freshness
   window/fingerprint, activation, policy set and boundary/cohort; require
   `boundaryEndUtc IS NULL`;
3. reread the selected PR8 `run.companyTimezone` and fresh PR5
   `receivablesTimezone`; validate each without alias replacement and require the
   exact equality `run = acceptance entry = authorization accepted snapshot =
   activation company snapshot = fresh PR5`. Freeze
   the accepted PR8 run value as
   `companyTimezoneSnapshot`; null, invalid, alias, unavailable, ambiguous or
   mismatched authority denies before event insertion;
4. reread the PR8 run/result, candidate, input set, operations, audit, seals,
   reconciliation and counts and require every term of
   `AcceptedPr8EvidencePredicateV1`: run `completed`, candidate
   `eligible_candidate`, complete seal, `diagnosticOnly = true`,
   `canonicalWriteAuthorized = false`, `productionActivationAuthorized = false`,
   zero blockers, the complete exact `run.candidateCount * 6` reconciliation row set,
   each row's three deltas and blocker state individually zero, exact row ordering/
   hashes/counts, exact accepted policy/ownership/source/timezone/reconciliation
   hashes, exact accepted pair and
   `finalizedAt <= attemptedAt < validUntilExclusive`; invalid integer-millisecond
   parsing, duration, window fingerprint or overflow denies; missing, duplicate,
   unrelated or cross-candidate/run rows deny and no delta netting is performed;
5. reread the complete current 16-table PR6 set defined in section 22.4, including competing
   versions, successors, overlaps, reopen/cancel/correct/supersession state,
   ownership manifests, upstream IDs and every row class; traverse all predecessor/
   successor relations, derive `economicLineageCandidateFingerprint`, accept and
   derive `rootSourceDocumentLineageId`/`rootCoverageLineageId` only after one root is
   proven, and derive `currentPr6RevisionHash`/`economicSourceRevisionKey` only after
   exactly one current revision is proven. Classify failures before event lookup in the exact
   source-lineage order: root/cycle/competing-root, broken successor, zero current and
   multiple current. For invalid current cardinality, construct only the exact
   registered invariant expected side (`unique`, count one, null key/hash) and the
   complete sorted observed state/set, including the registered empty-array hash for
   zero; never select a caller candidate, first sorted revision or synthetic ID. For
   broken successors, construct the complete sorted edge projection or select the
   exact unsafe-evidence operational error without conflict DML. A prospective
   lineage denial is frozen but not selected until step 6 has evaluated every
   higher-precedence authority denial;
6. reread the latest same-scope source-adapter and eligibility-producer authority
   chains and
   the posting authority referenced by the write authorization; compare the exact
   producer and posting ID/version/recordHash/company/branch/kind composites as well
   as the source-adapter ID/version/hash, scope, operation, source systems, complete row-class
   allowlist, owner, upstream IDs, artifact, commit, configuration, policy,
   effective interval, expiry and lifecycle; classify the first denial by the exact
   section-22.8 kind-major/suffix precedence after reconstructing every candidate in
   all three chains. Require each genuinely unaffected kind active/latest; retain any
   safely reconstructed lower-precedence concurrent denial only to prove why it was
   suppressed. Thus an authority denial wins over the prospective lineage denial and
   every persistable non-authority projection has both full authority composites;
7. reconstruct both named `DueDatePolicySetV1` members and select exactly
   `contractual_due_date` for proven provenance or `unknown_due_date_treatment` plus
   `UnknownDueDatePostingTreatmentMappingV1` for unknown provenance; reconstruct
   `cohortHash`, `boundaryHash`, `acceptedDryRunsHash`,
   `acceptedPr8EvidenceHash`, `sourceLineageHash`, `economicLineageKey` and
   `economicSourceRevisionKey`; require exact authorization/activation agreement,
   then query `(companyId,branchId,economicLineageKey)`,
   `(companyId,branchId,economicSourceRevisionKey)`, exact
   `(dryRunId,candidateId)`, and predecessor/successor event, operation and canonical
   identities throughout the locked correction graph before insert;
8. construct the complete event projection including the accepted PR8
   `companyTimezoneSnapshot`, policy-set hash, selected gate/treatment and nullable
   mapping triple and compute `eventHash`: use the existing row's
   persisted `occurredAt`/`createdAt`/`correlationId` when a lineage event exists;
   otherwise use the single `attemptedAt` and pre-generated repository correlation;
   also query `(companyId,eventHash)`. If one persisted event
   matches every field/hash, reread its bound PR8/PR6/authority/authorization/
   activation rows, commit with zero writes and return that event's persisted
   timestamps with `replayed=true`;
9. if a canonical row exists anywhere in the same correction graph with another
   revision, select `SOURCE_CORRECTION_AFTER_POSTING`; otherwise, if an event exists
   for the same lineage with another revision, select
   `SOURCE_CORRECTION_AFTER_ELIGIBILITY`; if current revision IDs match but its PR6 seal
   differs, select `SOURCE_REVISION_CHANGED_BEFORE_POSTING`. Otherwise, if the
   lineage/revision/candidate identity exists with different content, including
   timezone or due-policy drift, or any identity points to different scope/content,
   construct the exact registered `ConflictObservationV1`, roll back with zero
   event/canonical/audit/operation writes, and pass only its branded inert denial
   descriptor to Algorithm C only when the registry says persistence `required`;
   a `not allowed` authority observation opens the circuit without conflict DML;
10. otherwise construct and insert exactly one `ActualReceivableEligibleV1` using a
   pre-generated repository UUID and `occurredAt = createdAt = attemptedAt`;
11. reread the event plus accepted evidence, PR8 run timezone, fresh PR5 timezone and every referenced PR8, PR6,
    source/producer authority,
    authorization, activation and boundary row; recompute every exact field, pair,
    fingerprint and hash from persisted state, and require exactly one event for the
    company/branch lineage, exactly one for the current revision and exactly one for
    the run/candidate pair, with zero additional event/canonical rows on every
    competing root or successor identity;
12. commit only on byte-exact equality and return the persisted row. Any insert,
    trigger, reread or reconstruction failure rolls back to zero writes.

Algorithm A never reads PR7 forecast, never writes canonical, settlement, legacy or
`app_data` data, and cannot create an event from an unaccepted pair. Its exact replay
is a no-op only after current predicate/timezone/authority validation; a due-date,
amount, policy-set/selected-gate/mapping, timezone or authority change retains the
same lineage key and becomes conflict rather than a second event. A unique latest
replacement before the first event is allowed; after an event or posting, any new
revision of that lineage is a registered conflict. With no prior event,
missing/invalid/unavailable PR5 timezone produces no row; with a prior event it is
`COMPANY_TIMEZONE_DRIFT` and exact replay is forbidden until the authority matches.

### Algorithm B — PR9b canonical posting

Inside a separate repository-owned `BEGIN IMMEDIATE`:

1. capture and validate the single `attemptedAt` as above;
2. reread the event by exact ID/company/branch and recompute its
   `economicLineageKey`, `economicSourceRevisionKey`, `currentPr6RevisionHash`,
   `eventHash` and `sourceLineageHash`; traverse the complete predecessor/successor
   graph and query all event/operation/canonical identities for that root before any
   replay or DML; for an invalid root/current-revision cardinality, reconstruct the
   same invariant expected side, empty/non-empty observed set/state and broken-edge
   projection as Algorithm A, without deriving an expected root/revision from the
   persisted event. Zero current, multiple current and safe/unsafe broken successor
   follow the same required/not-allowed rules. Freeze but do not select any
   prospective lineage denial until the higher-precedence authority rereads in step 5
   complete;
3. reread the accepted evidence record and authorization accepted snapshot, selected
   PR8 `run.companyTimezone`, the activation timezone field and fresh PR5
   `receivablesTimezone`; require every value to be a canonical valid IANA name and
   byte-exactly equal to `event.companyTimezoneSnapshot`. Null, invalid, alias, unavailable, ambiguous or
   changed timezone is `COMPANY_TIMEZONE_DRIFT` before replay or DML;
4. repeat the exact `AcceptedPr8EvidencePredicateV1` evaluation—including
   `diagnosticOnly = true`, both write flags false, zero blockers, the complete exact
   six-per-candidate reconciliation row set with every individual delta zero, exact
   accepted evidence/timezone/hashes/pair and the exact half-open freshness window—
   and the full current PR6 16-table
   lifecycle/ownership/upstream-row reread from Algorithm A; no event-time decision
   is trusted;
5. reread latest source, producer and posting authority chains, the exact write
   authorization and its primary-effect/denial permissions, activation and boundary;
   validate every source/producer/posting authority ID/version/hash/company/branch/
   kind field, latest chain, source row classes, artifacts, policies, effective
   intervals, accepted evidence/pairs/timezone, both due-date policy-set members, the
   provenance-selected gate and optional mapping, cohort/boundary envelopes including
   null v1 end, and current lifecycle using `attemptedAt`; classify any authority
   denial by reconstructing all three chains/candidates, requiring genuinely
   unaffected kinds active/latest, and applying the complete section-22.8
   kind-major/suffix precedence before selecting any prospective lineage denial;
6. reconstruct the mapping using only the already accepted
   `event.companyTimezoneSnapshot`, derive `CanonicalPostingIdempotencyKeyV1`,
   recompute `CanonicalPostingCommandFingerprintV1` and prospective
   canonical row; query event, lineage, revision, every predecessor/successor event/
   canonical identity, idempotency, canonical external ID, operation and audit
   identities before DML. A successor after an existing canonical row is
   `SOURCE_CORRECTION_AFTER_POSTING`; otherwise a successor after eligibility is
   `SOURCE_CORRECTION_AFTER_ELIGIBILITY`; same revision IDs with a changed PR6 seal are
   `SOURCE_REVISION_CHANGED_BEFORE_POSTING`;
7. if a prior operation, canonical row and audit row all exist and every persisted
   field plus canonical/audit/operation/result fingerprint is exact, commit with zero
   writes and return the original IDs/timestamps with `replayed=true`;
8. on missing companion rows, changed content, source/policy/timezone/authority drift
   or any non-exact identity collision, construct the exact registered
   `ConflictObservationV1`, roll back all primary effects, then invoke Algorithm C
   with its branded inert denial descriptor only when its registry persistence is
   `required`; `not allowed` opens the circuit with no conflict DML;
9. otherwise insert one direct-`posted` canonical receivable with a pre-generated
   repository ID and `postedAt = createdAt = updatedAt = attemptedAt`;
10. compute the fingerprint of the persisted canonical projection, then insert one
   operation seal using pre-generated operation/audit IDs, exact source-adapter and
    posting-adapter full composites, producer composite through the event,
    accepted-evidence/pair/timezone/freshness, policy-set, selected-gate and mapping bindings,
    `createdAt = attemptedAt`, and the prospective audit and result fingerprints;
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

Algorithm C runs only after A or B has rolled back, only for a registry entry whose
persistence is `required`, and cannot share their transaction. A `not allowed`
authority denial never enters C and opens the P0 telemetry circuit directly. C
receives a frozen repository-derived denial descriptor, never a
caller-selected table/type/projection/fingerprint. In a new repository-owned `BEGIN IMMEDIATE`
it captures its own single `attemptedAt`, rereads the exact write-authorization
record and `denialEvidenceTable`/`denialEvidencePermission`, and rereads the bound
source/producer/posting authority as applicable, activation, scope, accepted
evidence and immutable denial identities/hashes.
The permission is evidence-only: it may remain inspectable when the primary status
caused the denial, but cannot authorize any primary-effect table or success path.
The conflict row's source and producer top-level composites must reproduce the frozen
attempt-bound write-authorization bindings byte-for-byte; its posting composite must
reproduce that authorization's and activation's common attempt binding, and any
referenced event/operation must agree, even when one authority is now terminal or
non-latest. For an authority conflict, the separate
`deniedAuthority*` composite must reproduce the exact observed record selected by the
prefix/suffix registry and the trigger must prove same logical authority ID plus the
exact suffix-specific record/descendant relationship. C rereads all three chains,
recomputes the unique global precedence result, requires every kind without a denial
candidate active/latest, and rejects a frozen lower-precedence type if a higher one is
now provable. A safely reconstructed lower-precedence concurrent denial is suppressed
under the single-observation rule; an ambiguous/unsafe concurrent denial fails
evidence persistence and opens the circuit. C cannot substitute the observed record
into the attempt binding and neither composite is evaluated as a grant of primary
authority.

For a temporal or freshness denial, the branded descriptor also retains the original
A/B `attemptedAt` only as transient repository evidence. It is never persisted or
hashed. Algorithm C uses its own clock only for its permission/lifecycle decision and
new conflict timestamps, and re-proves the original derived temporal/freshness state
against the immutable window plus original attempt. If the record/window changed
between rollback and C, C fails evidence persistence and opens the circuit; it does
not reclassify the denied primary attempt as success.

The repository validates the unexported descriptor brand, reconstructs the exact
registered expected and observed projections from persisted state, recomputes
`expectedFingerprint`, `observedFingerprint`, `conflictObservationJson`,
`conflictObservationHash` and `conflictHash`, returns an exact existing conflict as a
no-op, or inserts exactly one conflict with pre-generated ID and `detectedAt =
createdAt = attemptedAt`; it then rereads and recomputes the persisted row before
commit. An authority conflict additionally requires the exact all-non-null
same-scope denied-authority kind/record ID/version/hash composite; a non-authority
conflict requires all four columns null. No canonical, event, operation, audit, settlement, PR6/PR8, legacy or
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
- exact composite source-adapter and producer/posting
  ID/version/hash/company/branch/kind parent/FKs plus audit
  `(id,companyId,branchId)` FK;
- authority unique/latest-chain keys are scope-specific for all three kinds; one
  `actorId` succeeds in two company/branch scopes only through two independent
  chains, while cross-scope predecessor and consumer references abort;
- every v1 activation insert requires SQL/JSON-null `boundaryEndUtc`; a non-null
  value, update attempt or v1 hash fixture describing a bounded interval rejects;
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
- no getter or callback executes; restricted RFC 8785/JCS canonical JSON/hash
  fixtures are stable across the approved JavaScript and independent reference
  implementations;
- exact UTF-8 byte fixtures and SHA-256 outputs cover every section 22 envelope,
  null versus omission, array order, duplicate pair rejection, safe integer
  boundaries, Cyrillic, Tatar characters, emoji/non-BMP, slash, quotation mark,
  reverse solidus, every control escape, literal U+2028/U+2029 and a combining
  sequence; invalid UTF-8 and every lone-surrogate form reject before hashing;
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
  substitution deny in authorization, event and operation paths; a permitted
  conflict path preserves the exact attempt-bound source record and separately binds
  the observed denial under the same evidence-only trigger semantics;
- one-field mutation of producer version/hash/company/branch/kind and posting-adapter
  version/hash/company/branch/kind rejects; ID-only equality, cross-scope FK and
  latest-chain substitution reject in authorization, activation, event, operation,
  audit, result and conflict seals;
- conflict-trigger fixtures preserve exact stale/terminal attempt-bound producer and
  posting composites while separately binding the registry-selected observed denied
  record. Revoked, expired, superseded and latest-chain-mismatch evidence inserts
  succeed only under the registered Algorithm-C permission; substituting the latest
  observed record into an attempt-bound column rejects. The same stale/terminal
  composite still rejects in every primary-effect consumer trigger;
- trigger-level authority fixtures cover producer revoked with source/posting
  active/latest; producer revoked concurrently with a source denial selecting only
  the source observation; and posting denial only after source/producer precedence is
  clear. Different logical authority ID, company, branch or kind, non-contiguous or
  skipped successor, wrong persisted/reconstructed hash relationship and an
  unaffected non-latest chain each reject;
- same-record temporal fixtures cover `NOT_YET_EFFECTIVE` and time-window `EXPIRED`;
  contiguous same-chain fixtures cover terminal `REVOKED`, `SUPERSEDED` and
  `LATEST_CHAIN_MISMATCH`; an `expired` descendant cannot satisfy the same-record
  `EXPIRED` suffix and follows the registry's safely reconstructable applicable type
  or exact not-allowed path. Every one-field mutation of both the attempt-bound
  company/branch/kind/record ID/logical authority ID/version/hash projection and the
  observed parent/projection/linkage rejects. Lower-precedence evidence rejects when
  a higher candidate exists; safely reconstructed lower concurrent candidates do not
  create fan-out;
- every source, producer and posting authority prefix is exercised against all 11
  exact denial suffixes; each of the 33 literals verifies projection bytes,
  precedence, deduplication, immediate circuit class, PII/secret minimization and
  its exact `required`/conditional/`not allowed` Algorithm-C transition;
- accepted dry-run pair permutation canonicalizes identically, while duplicate IDs,
  unpaired IDs/hashes and a changed result hash deny under lock;
- catalog remains exact v1/11 and PR5–PR8 assertions continue passing.

### Eligibility event

- only an accepted, sealed, current, blocker-free PR8 candidate can emit;
- fixture/unaccepted/stale/unsealed/blocked candidate denies;
- the exact freshness interval is
  `finalizedAt <= attemptedAt < finalizedAt + 900000`; equality at the exclusive
  end is stale. Invalid `finalizedAt`, negative/wrong duration, unsafe addition,
  overflow, mismatched window fingerprint and `attemptedAt` before `validFrom` fail;
- the exact PR8 predicate accepts `diagnosticOnly=true`; it rejects
  `diagnosticOnly=false`, `canonicalWriteAuthorized=true`,
  `productionActivationAuthorized=true`, any blocker, incomplete seal, any non-zero
  per-row net/VAT/gross delta, hash/pair mismatch or stale evidence;
- the exact PR8 reconciliation selection proves all and only
  `run.candidateCount * 6` rows: `+100` and `-100` in different rows both fail;
  missing, extra, duplicate, unrelated-run and candidate/run-mismatched rows fail;
  separate fixtures mutate each one of `deltaNetMinor`, `deltaVatMinor` and
  `deltaGrossMinor` away from zero and fail without cross-row netting;
- every PR6 row/version/hash and every exact PR8 reconciliation row/hash/count is
  current;
- PR7/app_data fallback is structurally absent;
- economic lineage identity is stable across current UPD/coverage replacement IDs
  and policy/due/amount changes; exact replay creates no second event and changed
  source revision/policy/due/amount creates exactly its registered conflict;
- a unique replacement before the first event is accepted as the current revision;
  correction after event and correction after posting create their distinct conflict
  types and zero additional event/receivable rows; two apparent roots, cycle, broken
  or ambiguous predecessor, broken successor and zero/multiple current revisions fail closed. Invalid
  cardinality fixtures assert the exact `unique`/count-one/JSON-null invariant
  expected side, complete sorted observed hashes and deterministic observed-state
  precedence; no candidate-selected, first-sorted or synthetic expected ID is
  accepted;
- zero-current fixtures assert `missing`, count zero, null singular key, the exact
  registered empty-array bytes/hash and `SOURCE_LINEAGE_NO_CURRENT_REVISION`; repeated
  retry deduplicates byte-for-byte. Broken-successor fixtures cover missing target,
  cross-scope target, wrong root, multiple edges sorted deterministically, safe
  required persistence, unsafe exact operational error and cycle/root-conflict
  precedence over broken edge;
- proven provenance selects only the exact `contractual_due_date` member; unknown
  provenance selects only `unknown_due_date_treatment` with source literal
  `allow_unknown_without_aging` and the repository mapping to
  `post_without_aging_v1`; cross-gate selection, missing/mixed/mutated policy set,
  contractual `expectedSourceRef`/provenance mismatch, unknown source literal or
  mapping ID/version/hash drift produces
  `DUE_DATE_POLICY_DRIFT` and never changes PR8 or creates a second event;
- the accepted/run/activation/event/fresh-PR5 timezone fixture proves exact equality;
  old PR8 timezone plus new PR5 timezone, activation mismatch, invalid timezone,
  missing PR8 timezone and a parseable alias/non-canonical name all fail closed. The
  accepted PR8 value is stored as `companyTimezoneSnapshot` and covered by the
  acceptance and event hashes; no test substitutes the fresh PR5 value;
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
- Algorithm B repeats the full root/current-revision traversal and refuses a
  successor that appeared after Algorithm A, including concurrent old/new revision
  posting attempts;
- Algorithm B applies the identical exact PR8 predicate used by Algorithm A;
- timezone change between A and B is `COMPANY_TIMEZONE_DRIFT`; even an otherwise
  exact replay is denied, and canonical mapping never substitutes the new timezone;
- exact replay writes nothing; changed replay writes zero canonical rows and records
  only the approved conflict evidence;
- revocation/expiry between planning and lock denies;
- forced failure at receivable, audit, operation and reread stages rolls back all;
- wrong audit company/branch/correlation/aggregate/actor/event/payload and deliberate
  audit-fingerprint mismatch each roll back canonical and operation rows;
- the financial-audit fixture mutates or omits each persisted column independently:
  ID, company, branch, event type, aggregate type/ID, actor type/ID, occurredAt,
  reason, previous-value nullness, exact new-value JSON, correlation, source system
  and createdAt; every mutation aborts before commit;
- wrong audit event type is tested specifically against trigger activation by
  referenced audit ID, not merely caught by repository reread;
- primary-effect authorization cannot write the conflict table; denial permission
  cannot write any primary-effect table; algorithm C performs no business write;
- conflict evidence permission/scope/hash failure opens the circuit while leaving
  the denied primary effect at zero rows; repeat conflict deduplicates;
- every registered conflict type reconstructs its exact expected/observed
  projections; caller-selected type/projection/hash rejects, same observation
  deduplicates and any semantic projection mutation produces a new immutable hash;
- root and multiple-current conflict fixtures prove the only registered expected
  set-hash null rules, every root observation-state literal and its exact precedence;
  independent implementations produce identical side/observation/conflict hashes for
  zero roots, multiple roots, cycles, broken/ambiguous predecessors and multiple
  current revisions;
- unchanged authority/authorization/activation record content with only
  `not_yet_effective` or `expired` temporal evaluation persists a conflict whose
  expected/observed fingerprints differ and repeated same-state retries deduplicate;
- identical PR8 evidence hashes with `fresh`, `stale`, `not_yet_valid` and
  `invalid_window` states produce exact distinct observation fixtures; equality at
  expiry is stale and repeated stale retries deduplicate without raw attemptedAt;
- posting/conflict clock throw/invalid/out-of-range/regression rolls back and exact
  posting replay returns original persisted timestamps;
- persisted-row mutation/ignore/extra-row fault injection is detected;
- full PR9 canonical immutability and no-delete triggers are enforced.
- static call-graph and contract tests prove
  `CanonicalPostingCommandFingerprintV1` exists only in Algorithm B and requires an
  existing event ID; Algorithm A computes neither it nor an implicit input
  fingerprint, and pre-lock input validation cannot make an authority decision.

### Concurrency and operations

- independent processes produce one winner plus exact replay/conflict;
- no raw busy/locked errors, duplicates, orphan operations or missing audit;
- busy/locked injection at begin, each DML, reread and commit maps to
  `CANONICAL_POSTING_CONCURRENT_CONFLICT` with zero automatic retries;
- concurrent algorithm-A producers yield one event; concurrent algorithm-B posters
  yield one canonical/operation/audit set; conflict writers yield one hash row;
- concurrent old/new correction revisions for one lineage yield at most one event
  before eligibility and, after eligibility/posting, zero additional events or
  receivables plus the exact deduplicated correction conflict;
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
  D-PR9-08, Algorithms A/B and the field matrix, including exact six-per-candidate
  row selection, individual three-delta zero checks, no netting and sealed
  reconciliation-set/pair hashes;
- both named due-date policy members, provenance-selected gate, exact PR8
  `allow_unknown_without_aging` literal and versioned PR9
  `post_without_aging_v1` mapping absence/mix-and-match/mutation regressions;
- five-way event-production and five-way posting timezone equality, invalid/missing/
  unavailable/alias cases, acceptance/activation mismatch, A-to-B drift and replay
  after drift;
- same integration actor across multiple scopes produces separate authority IDs and
  chains; cross-scope chain, parent or consumer substitution rejects for all three
  authority kinds;
- audit trigger bypass attempt with wrong event type and incompatible shared audit ID;
- all 49 `ConflictObservationV1` types, including the 33 authority Cartesian-product
  literals, have projection, precedence, dedupe, circuit/persistence transition,
  PII/secret rejection and cross-implementation fixture cases;
- future validity endpoints excluded from the monotonic floor, operational
  regression/equality policy and exactly-one repository clock call;
- cohort ordering/duplicate rejection, boundary normalization/null-end rules and
  idempotency baseline plus every-field mutation fixtures; SQL/JSON null is the only
  v1 boundary end and every non-null/end-update path rejects;
- revoked source adapter and latest-chain source-adapter supersession deny after
  lock; ownership-manifest/upstream-row-class mismatch denies;
- concurrent event creation for one `economicLineageKey` commits exactly one event;
- unique replacement before event, correction after event, correction after posting,
  concurrent old/new revision event/posting attempts, two roots with the same
  apparent dimensions, cycle/broken predecessor, broken successor and zero/multiple-
  current-revision fixtures exercise all seven source conflict types; second event/receivable
  count is always zero;
- the same lineage/revision key with changed due date and with changed amount policy each
  produces deterministic conflict and never a second event;
- dry-run ID/result mix-and-match, duplicate ID/pair and changed accepted pair deny;
- omission or one-field mutation is exercised for every literal field in each
  section 22 envelope, with immutable cross-implementation canonical byte/hash
  fixtures, including the complete Unicode/JCS corpus and rejected lone surrogates;
- audit wrong ID, company, branch, event type, aggregate type/ID, actor type/identity/
  authority, occurred/created timestamp, reason, previous value, exact new-value
  payload, correlation or source system; missing audit; duplicate audit; and
  attempted audit update after operation all fail without a committed canonical
  effect;
- clock exactly at authority/activation/evidence expiry boundary denies; clock
  throw, invalid value, range failure and regression deny without writes;
- producer and posting-adapter version, hash, company, branch and kind one-field
  mutation fixtures plus cross-scope FK/latest-chain mismatch all deny; conflict-only
  trigger fixtures accept the exact immutable attempt-bound composite alongside the
  exact observed denied composite for permitted terminal/latest-chain denials, reject
  attempt/observed substitution, cross-logical-authority chain, non-contiguous
  successor and every observed-composite/linkage one-field mutation. Concurrent
  producer/source denial proves source precedence; an unaffected non-latest authority
  rejects. Every accepted denial-evidence fixture proves all canonical/event/
  operation/audit primary-effect row counts remain zero;
- unauthorized conflict append, caller-selected conflict operation/table, conflict
  persistence failure, deduplication and rate/circuit limits are fault-injected;
- conflict persistence failure returns
  `CANONICAL_CONFLICT_EVIDENCE_PERSISTENCE_FAILED`, opens the circuit and cannot
  convert the original denial into success.
- static regression proves the posting command fingerprint is Algorithm-B-only,
  event-bound and absent from Algorithm A.

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
