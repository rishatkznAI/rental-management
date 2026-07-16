# PR5 platform identity and RBAC architecture audit

**Program status:** `PR5: IMPLEMENTED FOR REVIEW — NOT RELEASED`

**Exact starting SHA:** `f071633e1df537dfe6595e31f3d222e0a5cc1515`

**Branch:** `codex/pr5-platform-identity-rbac-foundation`

**Worktree:** `/private/tmp/rental-management-pr5`

## 1. Audit boundary

This document records the factual repository state before PR5 implementation and the
implemented PR5 conformance evidence after the change. It does not authorize canonical
production reads or writes, financial settlement, bootstrap application, a Finance or
Company Health/Risks switch, backfill, dual write, shadow read, cutover, deployment, or
PR6 work.

The audit reviewed the canonical receivables contract, decision memo, PR4 design gate,
SQLite initialization and migration conventions, authentication/session behavior,
legacy role access, route registration, canonical PR1/PR2 schemas and repositories,
the PR3 read route/repository/service, frontend auth/permission representations, and
the related tests.

## 2. User and principal current state

- Human users are JSON records in `app_data.users`; no relational user table exists.
- `users[].id` is the only available stable human principal ID.
- Login resolves a unique user by login, requires legacy status `Активен`, and creates
  a server-side bearer session.
- `requireAuth()` reloads the current `users` collection, finds the current user by
  `session.userId`, checks current active status and session token version, and then
  creates `req.user`.
- The trusted human principal source for PR5 is therefore only
  `req.user.userId`, followed by another live `users` collection check.
- Missing users, duplicate user IDs, inactive users, and bot-only carrier users must
  fail closed.
- `user.role`, `req.user.permissions`, email, user name, `ownerId`, `ownerName`,
  `carrierId`, manager relationships, equipment relationships, request bodies,
  request query parameters, and request headers are not platform membership or
  capability authorities.
- No second user authority is introduced by PR5.

## 3. Session and authentication current state

- Sessions are stored in relational `app_sessions`, but their JSON payload contains
  legacy role/display metadata and collection permission summaries.
- Session `permissions` are UX/legacy route information and are not trusted PR5
  capabilities.
- Existing login and `/api/auth/me` response shapes are legacy production contracts
  and remain unchanged.
- Existing bot-only carrier login denial remains unchanged.
- Integration and system actors have no active PR5 authorization contract. Client
  headers cannot select a principal type or create a system/integration actor.

## 4. Existing roles and direct role checks

The legacy application recognizes display roles including `Администратор`,
`Офис-менеджер`, `Менеджер по аренде`, `Менеджер по продажам`, mechanic roles,
`Перевозчик`, `Инвестор`, and `Руководитель`. They are normalized by
`server/lib/role-groups.js`.

Legacy backend authorization is implemented through:

- `READ_PERMISSIONS` and `WRITE_PERMISSIONS` in `server/server.js`;
- `requireRead()`, `requireWrite()`, `requireRole()`, and `requireAdmin()`;
- role and entity-scope functions in `server/lib/access-control.js`;
- additional route-local role checks.

PR5 does not replace, narrow, or globally wrap these checks. New platform
authorization does not accept a display role as security input. In particular,
`Администратор` does not imply a company membership, company-wide branch authority,
or any platform capability.

## 5. Existing access-control and scope mechanisms

Legacy scope is role/entity based:

- rental and sales managers may be matched to editable manager IDs, names, or emails;
- investors may be matched through owner fields and equipment ownership;
- mechanics are linked through mechanic and equipment/service relationships;
- carriers are restricted by `carrierId`/`carrierKey`;
- administrators bypass most legacy entity filters.

These mechanisms remain only for existing released routes. They are not imported by
the PR5 platform identity or authorization modules.

The platform model instead uses:

- an active relational company membership;
- an exact active role-template version;
- an exact active capability-catalog version;
- explicit branch grants or explicit company-wide branch authority;
- concrete active branch IDs on every resolved scope;
- company and branch predicates in repository lookups.

## 6. Route authorization inventory

| Route area | Current authorization | PR5 behavior |
|---|---|---|
| Auth/profile/session | `requireAuth`, legacy user status and direct admin check | Unchanged |
| Generic CRUD | `requireAuth`, `requireRead`, `requireWrite`, `access-control.js` | Unchanged |
| Finance and legacy receivables | Legacy collection permissions and entity filters | Unchanged |
| Rentals and rental change requests | Legacy role/entity checks | Unchanged |
| Documents | Legacy document permissions | Unchanged |
| Deliveries | Legacy role and carrier DTO/scope checks | Unchanged |
| Service and repair items | Legacy role/mechanic/service checks | Unchanged |
| Reports | Legacy report permissions and route-local role checks | Unchanged |
| Planner, tasks center, readiness, staff | Existing route-specific checks | Unchanged |
| MAX bot | Existing bot authorization and connection model | Unchanged |
| Canonical receivables read | Feature-gated route plus injected trusted scope | Production resolver remains unconditional `null` |

No membership middleware is added globally to `/api`.

## 7. Existing company, branch, region, and location representations

- Operational JSON records contain editable labels such as equipment `location`,
  client `company`, delivery addresses, managers, owners, and other location-like
  fields.
- Company Health and legacy Finance have no stable company/branch/region scope
  contract.
- `app_settings` contains product settings, but no approved stable company authority,
  branch register, membership directory, or authoritative company IANA timezone.
- These labels and settings may be shown by bootstrap `inspect` only as candidate
  evidence. They are never security lookup keys and are never automatically mapped.

The checked-in worktree contains no production `server/data/app.sqlite`; therefore
PR5 does not claim local production record counts or mappings beyond the released
aggregate evidence already recorded by PR1–PR4.

## 8. Physical canonical roots and dependent foreign keys

### Fixed physical authority

- Physical company authority: `canonical_companies`
- Physical branch authority: `canonical_branches`
- Separate editable physical `companies` table: absent
- Separate editable physical `branches` table: absent

PR5 promotes the existing physical roots in place. It does not rename, drop, copy,
synchronize, or project them into another editable authority.

### Existing dependent foreign keys

- `canonical_receivables.companyId` references `canonical_companies(id)`.
- `canonical_receivables(companyId, branchId)` references
  `canonical_branches(companyId, id)`.
- `financial_audit_events.companyId` references `canonical_companies(id)`.
- `financial_audit_events(companyId, branchId)` references
  `canonical_branches(companyId, id)`.
- `canonical_payments` references the same company and composite branch roots.
- `canonical_payment_allocations` references the same company/branch roots and the
  PR1/PR2 financial tables.
- `canonical_receivable_adjustments` references the same company and composite branch
  roots.
- `canonical_approval_requests.companyId` references `canonical_companies(id)`.

PR5 does not rebuild canonical child tables and does not rebind these foreign keys.

## 9. Canonical trusted-scope current state

Before PR5, `server/server.js` passed a local
`resolveCanonicalReceivablesTrustedScope()` function that always returned `null` to
`registerCanonicalReceivablesReadRoutes()`. PR5 moves that strict boundary to
`server/lib/canonical-receivables-scope-adapter.js`; `server/server.js` imports only
the unconditional-null production resolver from that module.

Required retained production behavior:

- feature flag false: routes are absent and return 404;
- feature flag true: routes register, authentication may pass, but the production
  resolver returns `null`, so the request returns
  `403 RECEIVABLES_SCOPE_DENIED`;
- only isolated tests may inject a working adapter.

The generic real-principal resolver is implemented as a separate foundation module
and is not imported into production route registration.

## 10. Migration and initializer conventions

- `server/db.js::ensureDb()` enables foreign keys and initializes additive schemas.
- Migrations use `sql_shadow_schema_migrations`.
- PR1 migration is `canonical_receivables_pr1_schema` version 1.
- PR2 migration is `canonical_receivables_pr2_settlement` version 1.
- Existing initializers use SQLite transactions and register their migration after
  DDL.
- PR5 migration is `platform_identity_pr5` version 1.
- PR5 verifies exact PR1/PR2 prerequisites, physical roots, dependent FK,
  `foreign_key_check`, empty financial tables before first application, and absence
  of unexpected partial PR5 state.
- The migration upgrades only `canonical_companies` and `canonical_branches`
  additively and creates new security tables, indexes, triggers, and the deterministic
  server-owned capability catalog manifest.
- Normal startup creates no company, branch, Head Office, membership, role template,
  branch grant, membership capability assignment, bootstrap run, or financial row.

## 11. Existing audit behavior

`server/lib/security-audit.js` stores redacted legacy JSON audit records and caps the
collection at 10,000 entries. Logger failures are non-fatal. It is not suitable as
platform security authority.

PR5 introduces relational `authorization_audit_events` with append-only database
triggers. Platform security mutations and their audit events are committed in one
SQLite transaction. Company-level events use the real active Head Office branch.
Audit actor identity is derived only after trusted live-user/membership validation.
Audit `before`/`after` values accept only validated plain JSON objects, arrays, or
`null`; recursive secret-bearing keys and non-JSON/exotic structures are rejected.
There is no update, delete, replace, cap, TTL, or cleanup path.

## 12. Bot, integration, and system actors

- MAX bot state and display roles remain separate legacy operational behavior.
- A bot role or unlinked bot identity grants no platform capability.
- `integration` and `system` are recognized principal classifications for future
  named contracts only.
- PR5 ships no active integration/system contracts, seeds, or header bypass.
- The generic resolver authorizes only `user` principals and denies other types.

## 13. Proposed and implemented PR5 architecture

1. Promote `canonical_companies` and `canonical_branches` in place with neutral
   metadata, lifecycle status, optimistic version, and updated timestamp.
2. Add global branch-ID uniqueness while retaining the existing composite key and all
   existing child FK.
3. Create normalized memberships, branch-access history, versioned capability
   catalog, company-scoped role-template versions, membership grant/deny history,
   relational authorization audit, and bootstrap-run history.
4. Make `platform-identity-repository.js` the only application owner of platform
   identity/security DML.
5. Resolve scopes only from a live authenticated user, active membership, exact
   template/catalog versions, active assignments, and concrete active branches.
6. Materialize company-wide authority to sorted concrete branch IDs; never omit a
   branch predicate.
7. Keep canonical production route scope mapping unconditional `null`.
8. Provide separate inspect/validate/plan/apply bootstrap tooling with zero-write
   non-apply modes and explicit approval/checksum/backup/schema gates for apply.

### 13.1 Company authority

`canonical_companies` retains `id`, `receivablesTimezone`, and `createdAt` and gains
`displayName`, `status`, `version`, and `updatedAt`.

- IDs are immutable, opaque inputs; names are metadata and never lookup keys.
- `receivablesTimezone` remains the only physical authoritative timezone field.
- Status is `inactive`, `active`, or `archived`.
- Migration defaults are inactive and blank, so an old root cannot authorize.
- Repository writes validate IANA timezone values and optimistic versions.
- Resolver authorization requires active status, a valid IANA timezone, and a valid
  Head Office.
- Hard delete is blocked by a database trigger.

### 13.2 Branch authority and Head Office

`canonical_branches` retains `companyId`, `id`, `isHeadOffice`, and `createdAt` and
gains `displayName`, `status`, `version`, and `updatedAt`.

- `branch.id` is globally unique.
- Company ownership, ID, and Head Office identity are immutable.
- Status is `inactive`, `active`, or `archived`; only active branches authorize.
- Empty and obvious wildcard/sentinel IDs are rejected.
- Hard delete is blocked.
- Head Office is a concrete branch row, not null, wildcard, missing predicate, or
  company-wide marker.
- The existing single-Head-Office uniqueness protection is retained.
- Activation, bootstrap, and resolver checks require exactly one active Head Office
  for an active company.
- Company-level authorization audit records use that concrete Head Office ID.

### 13.3 Memberships and branch authority

`company_memberships` stores the exact company/principal link, exact role-template
version, explicit company-wide boolean, lifecycle timestamps, actor/reason metadata,
and optimistic version.

- Only `active` authorizes.
- `pending`, `inactive`, `revoked`, missing, and ambiguous memberships deny.
- Company and principal are immutable; revoked is terminal; hard delete is blocked.
- No membership is inferred from display role, login, session permissions,
  manager/owner/carrier fields, names, email, equipment, or bot state.
- Version increases for membership changes and every branch/capability mutation.

`membership_branch_access` is append-history-by-status:

- explicit mode requires at least one active concrete branch;
- company-wide mode requires zero active explicit grants and materializes every
  concrete active company branch;
- mixed explicit/company-wide state denies the entire scope;
- cross-company grants fail through repository validation and composite FK;
- revoke preserves the row and bumps both grant and membership versions;
- adding a branch never expands an explicit membership.

### 13.4 Catalog, templates, and individual assignments

Catalog version 1 is a deterministic server manifest with persisted SHA-256 checksum.
Its exact active namespace is:

- `companies.manage`
- `branches.manage`
- `members.manage`
- `receivables.read`
- `billing.period.close`
- `billing.period.reopen`
- `upd.form`
- `upd.conduct`
- `upd.correct`
- `forecast.read`
- `forecast.calculate`

The first three are company-scoped; all others are branch-scoped. Posting,
settlement, allocation, refund, reversal, and write-off capabilities are absent.
Catalog versions and entries are immutable. Missing, extra, inactive, multiple-active,
or checksum-mismatched catalog state denies.

`role_templates` and `role_template_capabilities` are company-scoped immutable exact
versions tied to the same catalog version. Display names are not a security
boundary. There is no automatic mapping from any legacy display role.

`membership_capability_assignments` stores active/revoked `grant` or `deny` history.
Effective capabilities are:

`(exact template capabilities UNION active grants) MINUS active denies`

Deny wins. Unknown, reserved, inactive, non-assignable, cross-catalog, duplicate, or
conflicting state rejects or denies. Company-scoped capabilities additionally require
explicit company-wide branch authority.

### 13.5 Trusted scope and repository predicates

`server/lib/platform-authorization.js` creates a deeply immutable, request-local
trusted scope containing:

- `authenticated`
- `principalType`
- `principalId`
- `companyId`
- `companyTimezone`
- `membershipId`
- `membershipVersion`
- `roleTemplateKey`
- `roleTemplateVersion`
- `capabilityCatalogVersion`
- sorted `capabilities`
- `companyWideBranchAuthority`
- sorted concrete `allowedBranchIds`
- `resolvedAt`

The principal comes only from authenticated `req.user.userId`, followed by a live
`app_data.users` check. Zero memberships deny; one selects itself; multiple require a
selector that matches one existing active membership. Company and branch selectors
only narrow. Scope freshness rechecks live user, company, membership version,
template, catalog, assignments, and branches without cross-request caching.

Scoped predicate helpers always produce both company and concrete branch predicates.
PR3 read repository scope was hardened so even company-wide injected test scopes use
`branchId IN (...)` or an already-validated concrete requested branch. A direct
repository caller cannot use a requested branch outside its concrete trusted list.
Inaccessible and nonexistent entity helpers both expose not-found behavior.

### 13.6 Production canonical resolver

The generic real-principal resolver is isolated foundation only.

`server/server.js` does not import `platform-authorization.js` or
`platform-identity-repository.js`. It imports the production canonical adapter
function whose complete behavior is:

```js
function resolveCanonicalReceivablesTrustedScope() {
  return null;
}
```

Therefore:

- flag false: canonical routes are absent and return 404;
- flag true: authentication may pass, scope returns null, request returns
  `403 RECEIVABLES_SCOPE_DENIED`, and the read service is not called;
- isolated tests may inject the future adapter with concrete branches;
- accidental feature enablement alone cannot expose canonical data.

### 13.7 Integration, system, and bot actors

Only a live authenticated human `user` principal resolves. Request headers, body,
query, session display permissions, or a client-supplied principal type cannot select
`integration` or `system`. No integration/system contract or seed ships. Bot-only
users and identities absent from the live user directory deny. Existing MAX bot
authorization remains unchanged and grants no platform capability.

### 13.8 Authorization audit

`authorization_audit_events` is relational and append-only:

- update, delete, and replace are blocked by triggers;
- actor type, principal, membership, membership version, and correlation ID are
  derived from an in-transaction validated trusted server context rather than copied
  from mutation input;
- audit `before`/`after` accepts only `null`, a plain object, or a standard array
  containing JSON primitives, plain objects, and standard arrays;
- raw strings and stringified JSON, custom prototypes/classes, `Date`, `Buffer`,
  `Map`, `Set`, functions, symbols, bigint, nested `undefined`, accessors, hidden
  properties, `toJSON`, proxies, cycles, sparse/custom arrays, and non-finite numbers
  are rejected without invoking user serialization hooks;
- secret-bearing keys are checked recursively and case/separator-insensitively,
  including password, secret, token, authorization, cookie, session, API-key, and
  private-key forms;
- canonical JSON uses sorted object keys and is limited to depth 24 and 64 KiB, with
  the size budget enforced during traversal;
- no cap, TTL, cleanup, or delete path exists;
- security mutation and audit insert share one `BEGIN IMMEDIATE` transaction;
- forced audit failure rolls back company, branch, membership, grant, assignment, or
  bootstrap mutations;
- company-level events use the real active Head Office branch.

The existing capped JSON security audit remains legacy-only and is not platform
authority.

### 13.9 Migration and startup

Migration `platform_identity_pr5` version 1:

1. enables and verifies SQLite foreign keys;
2. requires exact PR1/PR2 migration versions and prerequisite root columns, child
   tables, indexes, triggers, and FK targets;
3. requires clean `foreign_key_check`;
4. requires all six canonical financial/event tables to be empty;
5. rejects competing physical `companies`/`branches` and unexpected partial PR5
   state;
6. upgrades only the two existing roots additively in place;
7. creates PR5 tables, indexes, triggers, and deterministic catalog manifest;
8. verifies complete structure and FK integrity;
9. registers the migration last in the same transaction.

Rerun is idempotent and preserves `applied_at`. Applied-registry/incomplete-schema,
partial-state, prerequisite-object, and version mismatch are explicit errors. Forced
DDL failure leaves no root columns, PR5 objects, or registry row.

Normal `ensureDb()` only ensures schema. On a fresh fixture it creates:

- companies: 0
- branches: 0
- memberships: 0
- branch grants: 0
- role templates/template capabilities: 0
- membership capability assignments: 0
- authorization audit events: 0
- bootstrap runs: 0
- every canonical financial/event table: 0
- catalog versions: 1 deterministic manifest version
- catalog entries: 11 deterministic manifest entries

Repeated startup preserves those counts and the migration timestamp. Legacy
`app_data` is not changed by PR5 migration.

### 13.10 Bootstrap tooling

`server/scripts/platform-identity-bootstrap.js` exposes separate
`inspect`, `validate`, `plan`, and `apply` modes. It is not imported by startup.

- `inspect` opens read-only, emits stable user IDs/statuses, duplicate/missing IDs,
  display roles only as hints, company-like setting keys, location candidates/counts,
  migrations, table counts, feature-flag evidence, null-resolver evidence, schema
  fingerprint, and FK evidence without secrets.
- `validate` performs zero writes and blocks invalid IDs/timezone/Head Office,
  duplicate branches/memberships, unresolved active users, role inference, invalid
  templates/capabilities/assignments, mixed branch modes, financial rows, FK errors,
  schema-fingerprint drift, missing approval, or missing backup metadata.
- `plan` performs zero writes and returns deterministic checksum, exact changes,
  before/after counts, blockers/warnings, required approval checksum, schema
  fingerprint, users-directory fingerprint, normalized mapped and intentionally
  unmapped users, approved operator, and complete eligible-active-user coverage.
- `apply` requires literal `--apply`, exact confirmed checksum, matching approved
  checksum/fingerprint, active bootstrap operator, approval reference, backup
  reference, zero blockers, empty financial tables, and empty authority.
- The config checksum covers the security-relevant users-directory fingerprint and
  normalized mapping plan as well as authority configuration.
- Apply obtains `BEGIN IMMEDIATE` before transactional revalidation, rereads
  `app_data.users`, and rechecks JSON shape, duplicate/missing IDs, eligibility,
  `approvedBy`, mappings, intentionally unmapped users, complete active-user
  coverage, users/schema fingerprints, financial counts, FK state, and authority
  state before any authority DML.
- A second SQLite writer cannot alter users while the apply transaction holds the
  lock. Concurrent applies deterministically produce one success and one
  approved-checksum no-op.
- Repeating the same successful checksum is a no-op only after the live approved
  human operator and users directory are revalidated. Changed security-relevant user
  state or authority configuration requires a new plan and matching approval.

Only the redacted placeholder example is committed. No production IDs, mappings,
template holders, approval, or backup evidence are included, and no bootstrap was run.

## Independent review remediation

The independent security review evaluated old head
`447a34743cc06823d83df7ffb917ded17a99cb04` and reported three P1 findings and one
P2 finding. This remediation fixes all four boundaries without enabling production
reads, writes, bootstrap, release, or PR6.

### Trusted audit actor (P1)

- Generic platform mutations no longer accept the old arbitrary `actor` DTO.
- Callers must supply an opaque server-created human actor context. The repository
  rereads the current users directory inside the same `BEGIN IMMEDIATE` transaction
  and requires exactly one eligible active human record for the authenticated stable
  principal ID.
- If an actor membership is supplied, the live membership must exist, be active,
  belong to the mutation company and actor principal, and exactly match the expected
  stored version. The audit event records the membership version reread from SQLite,
  never a caller-provided audit value.
- Without an actor membership, generic access is limited to initial provisioning
  while the target company has no membership rows. It cannot be used for ordinary
  later management mutations.
- Bootstrap has a separate internal operator contract: `approval.approvedBy` must be
  exactly one eligible active human user and is revalidated live even for a
  same-checksum no-op. This operator may be intentionally unmapped, but cannot be a
  system/integration actor.
- Arbitrary `system` and `integration` actors are default-denied. Header, body, query,
  display-role, and session-permission values cannot select an audit actor. PR5 ships
  no active integration/system contract or hardcoded bypass actor.

### Recursive audit payload protection (P1)

- `before` and `after` accept only `null`, plain JSON objects, or standard JSON
  arrays; raw/plain strings and stringified JSON are rejected.
- Validation walks the actual structure before serialization, checks secret-bearing
  keys at every depth and inside arrays, rejects exotic/non-JSON values and custom
  serialization behavior, enforces finite numbers, cycle/depth/size limits, and then
  emits deterministic canonical JSON.
- Any validation or audit insert failure rolls back the surrounding security
  mutation and audit event.

### Bootstrap users-directory TOCTOU (P1)

- The plan and approval checksum now include a deterministic fingerprint of stable
  user IDs, current status, bot/frontend eligibility flags, duplicate/missing IDs,
  eligible active users, mapped users, intentionally unmapped users, and
  `approvedBy`. Passwords, tokens, secrets, display names, display roles, and JSON
  field ordering are excluded.
- After `BEGIN IMMEDIATE`, apply repeats the complete users/mapping/operator,
  schema/FK, financial, and identity validation and compares it to the approved plan
  before the first authority write.
- Deactivation/deletion/duplication of the operator, mapped-user removal, new active
  unmapped users, intentionally-unmapped coverage drift, or eligibility-field drift
  fails explicitly and leaves authority, audit, bootstrap-run, and financial counts
  unchanged.
- Independent-connection and child-process tests prove writer exclusion and
  deterministic concurrent apply behavior.

### Company-scoped capability configuration (P2)

- An explicit-branch membership bound to a template containing
  `companies.manage`, `branches.manage`, or `members.manage` now denies the entire
  resolved scope.
- Active individual grants of those company capabilities to an explicit membership
  also deny the entire scope.
- Repository create/update/activation/template-binding/grant paths and bootstrap
  validate/plan/apply reject incompatible state before write. Manual inconsistent DB
  state fails closed in the resolver; capabilities are never silently removed to
  produce a partial scope.
- Company-wide memberships may still use approved company-scoped capabilities, and
  an active deny assignment still wins.

### Added targeted evidence

Targeted tests cover missing/inactive/duplicate/forged actors; cross-principal,
cross-company, nonexistent, inactive, and stale actor memberships; version
substitution; arbitrary system/integration and request-selected actors; active and
invalid bootstrap operators; recursive secret variants; stringified JSON; custom
prototypes/serialization; exotic values; cycles/depth/size; rollback; all requested
users-directory drift cases; SQLite writer locking and concurrent apply; incompatible
company capabilities; competing `companies`/`branches` physical roots; and prior
application initializer compatibility after the additive migration.

The owner approvals listed in section 16 remain required. No production identity
mapping, bootstrap approval, integration/system contract, audit-retention operation,
release, or cutover decision is introduced by this remediation.

## 14. Risks and blockers

| Risk | Treatment |
|---|---|
| Legacy names or display roles are mistaken for authority | Forbidden by resolver/repository APIs and static tests |
| Old application inserts a root row after rollback | New columns have fail-closed inactive defaults; old initializer sees the same physical roots and creates no second authority |
| Company-wide scope removes branch filtering | Resolver materializes active branch IDs and repository predicates always include `branchId IN (...)` |
| Active company has missing or multiple active Head Offices | Resolver, repository, bootstrap validation, and schema uniqueness fail closed |
| Catalog or exact template version drifts | Persisted deterministic checksum and exact-version checks deny |
| Mutation succeeds without audit | Same transaction; forced audit failure rolls the mutation back |
| Feature flag is accidentally enabled | Production resolver still returns `null`; canonical data remains inaccessible |
| Existing legacy users lack PR5 memberships | Existing routes remain on legacy authorization and are unaffected |

No owner-decision blocker prevents this foundation implementation. Concrete production
identity records, mappings, templates, grants, and bootstrap approvals remain owner
inputs and are not invented by PR5.

## 15. Changed-file inventory

### Schema and startup

- `server/lib/platform-identity-schema.js` — additive in-place root promotion,
  normalized security schema, catalog manifest, constraints, triggers, migration
  verification.
- `server/db.js` — calls only `ensurePlatformIdentitySchema()` after exact PR1/PR2
  initialization.

### Identity, authorization, and audit

- `server/lib/platform-identity-repository.js` — sole application DML owner for
  company/branch identity, templates, memberships, branch grants, assignments,
  authorization audit, and bootstrap-run application.
- `server/lib/platform-authorization.js` — live user/membership/catalog/template/
  assignment/branch resolver and neutral scope helpers.

### Production fail-closed boundary and PR3 hardening

- `server/lib/canonical-receivables-scope-adapter.js` — unconditional-null production
  resolver with no dependency on the generic authorization module.
- `server/lib/canonical-receivables-scope-test-adapter.js` — isolated future/test-only
  mapping from generic scope to the PR3 scope shape.
- `server/server.js` — imports only the unconditional-null resolver; no real resolver
  wiring.
- `server/lib/canonical-receivables-read-repository.js` — requires concrete branches
  for every injected scope and rejects out-of-scope requested branches.
- `server/lib/canonical-receivables-read-service.js` — preserves company-wide metadata
  while requiring materialized concrete branch IDs.

### Bootstrap tooling and documentation

- `server/lib/platform-identity-bootstrap.js` — inspect/validate/plan/apply engine.
- `server/scripts/platform-identity-bootstrap.js` — separate CLI entry point.
- `docs/platform-identity-bootstrap.example.json` — redacted placeholder only.
- `docs/platform-identity-rbac-pr5-audit.md` — this current-state, architecture,
  conformance, operation, and rollback record.

### Tests

- `tests/platform-identity-fixtures.js`
- `tests/platform-identity-schema.test.js`
- `tests/platform-authorization.test.js`
- `tests/platform-identity-bootstrap.test.js`
- `tests/platform-identity-remediation.test.js`
- `tests/platform-identity-safety.test.js`
- `tests/canonical-receivables-read-fixtures.js`
- `tests/canonical-receivables-read-safety.test.js`

No frontend file, legacy route module, Finance implementation, Company Health reader,
canonical write repository, settlement behavior, or PR6 source module is changed.

## 16. Owner approvals still required

- company opaque ID, display name, and IANA timezone;
- Head Office ID and display name;
- operational branch IDs and approved legacy location mappings;
- user memberships and intentionally unmapped users;
- explicit versus company-wide branch authority;
- role-template versions and capabilities;
- membership grants and denies;
- management and receivables/billing/UPD/forecast capability holders;
- bootstrap operator, approval procedure/reference, and backup evidence;
- authorization-audit access and retention operations;
- future named integration/system contracts.

## 17. Rollback

Application rollback deploys the prior application code while retaining the additive
PR5 schema. The physical roots remain `canonical_companies` and
`canonical_branches`; old initializers do not create another authority. The canonical
read flag remains false and the production resolver remains null.

Configuration rollback in a future controlled environment inactivates/revokes
memberships, grants, and assignments with append-only audit. It does not delete or
reuse IDs.

There is no destructive automatic down migration. Physical restore is allowed only
from a verified backup in a maintenance window with separate approval.

## 18. PR6 entry criteria

PR6 remains blocked until PR5 is reviewed and released, concrete production identity
and authorization mappings are approved and applied through the controlled bootstrap,
and the separate PR6 source-authority/accounting/legal gates in the canonical
receivables contract are satisfied. PR5 itself starts no PR6 source, billing-period,
UPD, forecast, posting, or settlement implementation.

## 19. Architecture conformance assertions

- Physical company authority: `canonical_companies`
- Physical branch authority: `canonical_branches`
- Separate editable `companies` table: absent
- Separate editable `branches` table: absent
- Canonical child-table rebuild: no
- Canonical child-FK rebinding: no
- Identity write owner: platform identity repository/bootstrap tooling only
- Production resolver: unconditional null/fail-closed
- Flag true plus production resolver: 403 before data access
- Legacy route authorization changed: no
- Finance switched: no
- Company Health/Risks switched: no
- Frontend changed: no
- Financial rows created: no
- PR6 started: no

Existing physical `canonical_companies` and `canonical_branches` were promoted in
place to the single neutral platform identity authority.

No separate editable `companies` or `branches` authority was introduced.

Existing canonical child foreign keys remain attached to the same physical roots. No
child-table rebuild or foreign-key rebinding was required.

## 20. Verification record

Focused PR5 verification covers migration failure/rerun/integrity, single physical
authority, repository mutations and versioning, Head Office, live principals,
membership states, explicit/company-wide branch scope, exact catalog and templates,
grant/deny behavior, immutable trusted scope, selectors, freshness, audit atomicity,
bootstrap modes/gates/no-op, production 404/403 behavior, concrete PR3 predicates,
startup zero-authority counts, and static exclusions.

Executed before commit:

| Command | Result |
|---|---|
| `node --test tests/platform-identity-remediation.test.js tests/platform-authorization.test.js tests/platform-identity-bootstrap.test.js tests/platform-identity-schema.test.js tests/platform-identity-safety.test.js tests/canonical-receivables-read-safety.test.js` under Node `v20.20.2` | 81 passed, 0 failed, 0 skipped |
| `npm test` under Node `v20.20.2` (full suite pass 1) | 1884 passed, 0 failed, 0 skipped |
| `node --test tests/*.test.js` under Node `v20.20.2` (full suite pass 2) | 1884 passed, 0 failed, 0 skipped |
| `npm run build` | success; Vite transformed 3385 modules |
| `git diff --check` | clean |

Final isolated SQLite fixture:

- `PRAGMA foreign_keys`: `1`
- `PRAGMA foreign_key_check`: `0`
- `canonical_companies`: `0`
- `canonical_branches`: `0`
- `company_memberships`: `0`
- `membership_branch_access`: `0`
- `role_templates`: `0`
- `role_template_capabilities`: `0`
- `membership_capability_assignments`: `0`
- `authorization_audit_events`: `0`
- `identity_bootstrap_runs`: `0`
- catalog versions: `1`
- catalog entries: `11`
- `canonical_receivables`: `0`
- `financial_audit_events`: `0`
- `canonical_payments`: `0`
- `canonical_payment_allocations`: `0`
- `canonical_receivable_adjustments`: `0`
- `canonical_approval_requests`: `0`
- production canonical resolver result: `null`

The final verification environment used Node `v20.20.2` and npm `10.9.4`, matching
the `20.x` engine declared by both package manifests. Native dependencies were
installed in an isolated verification copy; package manifests and lockfiles were not
changed.
