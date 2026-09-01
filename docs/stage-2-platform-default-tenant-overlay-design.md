# Stage 2 authoritative scope semantics: platform defaults + tenant-owned overlays

Status: **AUTHORITATIVE BUSINESS SEMANTICS / FIELD AUTHORIZED / IMPLEMENTATION IN PROGRESS**

- Recorded: 2026-08-31
- Reconstruction branch: `codex/code-data-remediation-reconstructed`
- Reconstruction base: `origin/main` at `1375faa0645c9c9f470a92f65c2cfd2839060ef0`
- Base tree: `6c6dfd013e8352a779129c13cc3831a228b13c46`
- Production mutation, deployment, rollout, configuration change, migration, restore, and write-freeze removal: **not authorized and not performed**
- Stage 7: **not started**

This document supersedes the tenant-only interpretation of the following eight
`app_data` collection families:

- `knowledge_base_modules`
- `service_works`
- `spare_parts`
- `service_route_norms`
- `service_work_catalog`
- `spare_parts_catalog`
- `service_work_names`
- `spare_part_names`

## 1. Authoritative business semantics

1. Proven existing system/reference records are platform defaults. They must not
   be assigned to a Company merely because production currently has one Company.
2. A platform default has platform/system scope. An authorized tenant may read
   it, but a tenant actor may not edit, archive, delete, replace, or otherwise
   mutate it. Only an explicitly allowlisted trusted platform/system operation
   may mutate the platform partition.
3. A tenant may create tenant-owned catalog entries. Such a record must have
   authoritative exact ownership (`companyId === tenantId`) derived from trusted
   actor authority, is visible only inside that tenant, and is mutable only by
   the roles already permitted for the family inside that tenant.
4. Customizing a platform default creates a tenant-owned override/copy. It does
   not mutate the platform row.
5. Tenant effective read is platform defaults plus that tenant's entries and
   overrides. One valid own-tenant override replaces its linked default in the
   effective projection. No foreign-tenant record may participate.
6. Tenant delete/archive never changes a platform default. Reverting/deleting an
   override exposes the default again.
7. A platform update never overwrites an existing tenant override.
8. Cross-tenant reads, links, overrides, and writes fail closed.
9. Generic CRUD may not elevate tenant ownership to platform scope or move a row
   from tenant A to tenant B.
10. Existing proven defaults and existing exact-tenant records are retained
    without mass rewriting solely to classify them.

## 2. Evidence baseline

The sealed read-only production re-scope evidence classified 399 rows as
`GLOBAL_SYSTEM_DATA` and explicitly required a mixed global-default/tenant-overlay
model:

| Collection | Proven unscoped platform rows | ID evidence |
| --- | ---: | --- |
| `knowledge_base_modules` | 4 | all have stable IDs |
| `service_works` | 141 | all have persisted stable `SW-*` IDs |
| `spare_parts` | 125 | all have persisted stable `PT-*` IDs |
| `service_route_norms` | 4 | all have stable IDs |
| `service_work_catalog` | 0 | no current row |
| `spare_parts_catalog` | 125 | byte-identical to `spare_parts`, with the same IDs in the other collection |
| `service_work_names` | 0 | no current row |
| `spare_part_names` | 0 | no current row |

Relevant evidence is in the prior read-only worktree under
`output/production-rescope-readonly-20260826/`, especially `report.md` sections
E, F, L, M, N, and U, `collection-plan.json`, and
`simulation-results.json`. It proves that the tenant-only boundary hid all 399
rows (`expectedGlobalReferenceVisible=399`, `actualGlobalReferenceVisible=0`).

The current repository shapes do not provide a universal override link:

- all consumers use `id` as the catalog record identifier;
- work and part seeds contain no IDs and normalizers generated the persisted
  production IDs at initial load;
- title/name/article/category/from/to are editable, absent from some families,
  and not uniqueness invariants;
- `catalogId`, `workId`, `partId`, `moduleId`, and `routeNormId` are foreign
  references in consumers, not default-to-override linkage fields.

## 3. Identity decision required before implementation

### 3.1 Same physical `id` is not an already-safe key

Reusing a platform default's `id` as the physical tenant override `id` would
require a new composite identity contract `(collection, scope, id)`. It is not a
drop-in use of an existing safe key:

- `tenant-data-boundary.js` rejects a tenant ID that already exists outside the
  tenant and platform validation rejects duplicate raw IDs;
- `tenant-relationship-guard.js` gathers all raw rows matching a bare ID and
  requires exactly one authoritative target;
- generic CRUD, service, bot, reports, workload, startup migration, and frontend
  code mix first-match `.find`, last-match `Map`, and first-match deduplication;
- platform default deletion/reintroduction would change whether a same-ID scoped
  row is classified as an override or a standalone row;
- a generic POST with a guessed default ID could become an implicit override
  unless all create paths were replaced with a dedicated lifecycle;
- anonymous legacy rows cannot participate in same-ID overrides.

Adopting same-ID overlays is therefore a separate high-risk identity redesign,
not an implementation detail authorized by the current decision.

### 3.2 Recommended minimal representation

The recommended representation preserves globally unique physical IDs and adds
one explicit optional persistent JSON field on tenant overrides:

`platformDefaultId`

Raw platform default:

```text
id: globally unique stable physical/logical ID
companyId: absent
tenantId: absent
platformDefaultId: absent
```

Raw tenant standalone entry:

```text
id: globally unique stable physical/logical ID
companyId: exact trusted Company ID
tenantId: same exact ID
platformDefaultId: absent
```

Raw tenant override (stored as a full copy, not a fuzzy patch):

```text
id: new globally unique server-owned physical ID
companyId: exact trusted Company ID
tenantId: same exact ID
platformDefaultId: stable ID of an unscoped default in the same collection
```

Required invariants:

- at most one active override for `(collection, companyId, platformDefaultId)`;
- `id`, ownership, and `platformDefaultId` are immutable after creation;
- a link must resolve to exactly one unscoped default in the same collection;
- dangling, cross-collection, tenant-targeted, duplicate, partial-scope, and
  foreign-tenant links fail closed;
- an unscoped row carrying `platformDefaultId` is invalid;
- request payloads cannot set ownership or `platformDefaultId` through generic
  create/update/bulk APIs;
- the link is created only by a dedicated explicit "create tenant override"
  operation against a visible platform default;
- a tenant standalone entry with the same name/article/title remains standalone;
  natural-key matching never turns it into an override;
- platform default deletion or ID change is blocked while any override refers to
  it, unless a separately reviewed lifecycle is later approved;
- missing-ID legacy defaults are preserved and immutable but non-overridable.

Effective tenant read:

1. Validate the full raw collection and its identity/linkage invariants.
2. Select all proven unscoped platform defaults.
3. Select only exact current-tenant rows; reject any ambiguous current-tenant
   override linkage rather than selecting a winner.
4. Replace a default with its own-tenant override.
5. Append own-tenant standalone entries.
6. Exclude every foreign-tenant row.
7. Project an override with logical consumer `id = platformDefaultId`; keep its
   physical storage ID server-internal. A derived, non-persistent origin marker
   such as `catalogOrigin = platform_default | tenant_entry | tenant_override`
   may be returned for correct UI actions.

The logical-ID projection preserves existing `workId`, `partId`, `moduleId`,
`routeNormId`, and progress/history references. PATCH/revert/delete for mixed
catalogs must use a dedicated resolver that maps the logical default ID to the
current tenant's physical override; generic visible-array replacement is not a
safe persistence API.

This representation adds no SQL column and requires no rewrite of the current
399 rows. The optional persistent JSON field `platformDefaultId` was explicitly
authorized on 2026-08-31 for this representation only.

## 4. Contradiction classification

### Still valid

- `output/production-rescope-readonly-20260826/report.md`: the 399-row
  `GLOBAL_SYSTEM_DATA` classification, seed/reference evidence, mixed
  default/overlay conclusion, visibility failure, and "do not assign to
  Skytech" conclusion.
- `output/production-rescope-readonly-20260826/collection-plan.json` and
  `simulation-results.json`: counts and expected platform visibility.
- Membership-derived trusted actor authority, exact-tenant anti-spoof rules,
  unknown-role/unknown-collection fail-closed behavior, and CAS/concurrency
  protection from the audited remediation boundary.
- The dirty remediation startup behavior that disables process-start business
  data writes. The comment that no catalog is global is not valid.
- Read-only `scripts/import-service-works-catalog.cjs` and
  `scripts/import-spare-parts-catalog.cjs`; their disabled apply behavior remains
  required.
- System import/export and legacy sync currently excluding all eight families.
- Full SQLite backup behavior.
- Byte-for-byte clean-reset retention as a behavior. The catalog descriptions
  and complete eight-family coverage need correction.
- Existing role restrictions and domain validation for catalog content, provided
  a separate default-immutability/mixed-scope layer is added.

### Superseded

- The exact tenant-only catalog classification in
  `docs/application-wide-tenant-isolation-audit.md`.
- `server/lib/app-data-scope-registry.js` entries that put all eight collections
  in `TENANT` and leave `GLOBAL_REFERENCE` empty.
- `server/lib/production-scope-evidence-classification.js` catalog rows classified
  as `TENANT_CATALOG_SEED` / tenant data.
- `server/lib/production-scope-remediation-manifest.js` operations that assign the
  399 defaults to the canonical Company and treat remaining global catalog rows
  as a blocker.
- Catalog classifications in generated
  `server/config/future-write-audit-matrix.json`; it must be regenerated from the
  new policy rather than hand-edited.
- Tenant-catalog expectations in
  `server/scripts/simulate-production-scope-remediation.js` and
  `server/scripts/verify-production-scope-local-visibility.js`.
- Tests whose asserted product behavior is tenant-only or hides the proven
  unscoped defaults:
  - `tests/app-data-scope-registry.test.js`
  - catalog sections of `tests/tenant-data-boundary.test.js`
  - catalog sections of `tests/trusted-actor-scope-server-e2e.test.js`
  - catalog sections of `tests/production-scope-remediation-manifest.test.js`
  - catalog sections of `tests/production-scope-evidence-builder.test.js`
  - relevant catalog expectations in `tests/production-smoke-identity.test.js`

### Needs update

- `docs/application-wide-tenant-isolation-audit.md`: retain the broader tenant
  isolation rules, replace the eight-family category and read/write semantics.
- `docs/skytech-clean-production-reset.md`: retain byte-for-byte preservation,
  replace exact-tenant wording with mixed partition wording, and cover both name
  collections.
- `docs/processes-and-interface.md`: tenant CSV import must not match a platform
  default into an override by article/name.
- `server/lib/skytech-clean-production-reset.js`: preserve all eight families and
  describe both partitions correctly.
- `server/lib/startup.js`: keep process startup write-free for business catalogs,
  replace the tenant-only comment, and reserve any future seed write for an
  explicit trusted platform lifecycle.
- `server/lib/tenant-data-boundary.js`,
  `server/lib/tenant-relationship-guard.js`, `server/lib/access-control.js`,
  `server/lib/future-write-audit-policy-builder.js`, `server/server.js`,
  `server/routes/crud.js`, `server/routes/service.js`, and
  `server/routes/system.js`.
- `server/lib/data-integrity-diagnostics.js`: distinguish raw malformed links
  from valid effective replacement; do not use mutable names as identity.
- Frontend types/services/actions in `src/app/types.ts`,
  `src/app/pages/KnowledgeBase.tsx`, `src/app/pages/Settings.tsx`,
  `src/app/pages/ServiceDetail.tsx`, and
  `src/app/lib/sparePartsImportExport.js`.
- Startup, access, CRUD, system, reset, maintenance, bot, service, report, and E2E
  fixtures that assume one physical row per visible ID or full-list replace.

## 5. Read/write/delete/replace/import/startup/reset audit

| Path | Current behavior/risk | Required target behavior |
| --- | --- | --- |
| Scope registry and boundary | Collection-exclusive `TENANT` or `GLOBAL_REFERENCE`; cannot represent both partitions | New mixed category and separately authorized platform/tenant partition writers |
| Generic CRUD for first six families | GET/PATCH/DELETE use bare `id`; POST/PATCH/DELETE/PUT write a full visible array | Mixed-specific repository/lifecycle; platform default immutable to tenant; tenant partition only |
| `service_work_names`, `spare_part_names` | Stored but no active HTTP/frontend writer; fail closed | Keep fail closed unless an explicit role/API consumer is required; internal reads still use effective semantics |
| Knowledge-base UI/API | Edit/delete any visible module; progress references `moduleId` | Default action creates override; revert deletes override; progress resolves logical ID |
| Work active/deactivate and repair facts | First/last-wins bare-ID lookups; deactivate writes whole list | Effective logical resolver; deactivating default creates override; no raw ambiguity |
| Part active/deactivate and repair facts | Same risk as works | Same mixed-specific behavior |
| Route norm Settings UI | Every create/edit/toggle/delete sends full-list PUT | Replace only tenant partition; default edit creates override; omission never deletes default |
| Bot, reports, workload, service consumers | `.find`, `Map`, or dedupe by bare physical ID | Consume only validated effective projection, never raw mixed arrays |
| Relationship guard | Requires one raw target per bare ID | Resolve one effective logical target for actor scope; reject foreign/dangling/duplicate links |
| Browser CSV parts import/export | Exports effective list and matches import by article/name, then bulk replaces | Tenant-only import; no automatic override inference; explicit override command only |
| CLI catalog importers | Strict read-only now; old apply concept is whole replace and may regenerate IDs | Remain read-only until a platform manifest keyed by persisted stable IDs exists |
| `origin/main` startup | Automatically clones/seeds works, parts, KB, and routes | Reconstruction must retain audited no-business-write startup behavior |
| Dirty remediation startup | Business catalog writes disabled | Keep; future explicit platform provisioning may seed only platform partition, never every tenant |
| Legacy reference/repair migration | Bare-ID/name lookup and possible full collection writes | Remain dry-run/disabled; any future apply must be effective-scope and manifest driven |
| System data import/export and legacy sync | Eight families excluded | Keep exclusion unless a partition-aware format is separately designed |
| External-photo archive | Currently derives collection list from tenant category and rewrites full effective collections; can mutate visible defaults | Exclude mixed catalogs or mutate exact own-tenant physical rows only; never archive platform media via tenant actor |
| Full backup | Copies raw SQLite | Still valid; preserves defaults and overlays |
| Clean reset | Retains catalog JSON byte-for-byte, but wording/list are inconsistent | Retain both partitions and all eight families byte-for-byte |
| Demo seed/reset | Adds scoped work/part fixtures and removes `DEMO-*` rows | Preserve defaults; prove a platform ID cannot be deleted by demo cleanup collision |
| Production remediation classifier/manifest | Plans 399 tenant scope updates | Classify them `PLATFORM_DEFAULT_REFERENCE`, operation `PRESERVE_PLATFORM_DEFAULT`, migration `NO` |
| Diagnostics | Name-based duplicate findings and incomplete family coverage | Scope-aware/effective diagnostics; malformed linkage is blocking, name duplicates are not override identity |

## 6. Required adversarial coverage

Before Stage 2 reconstruction can receive audit PASS, tests must prove:

- a tenant cannot PATCH, deactivate, archive, DELETE, or bulk-replace a platform
  default;
- a tenant cannot promote its standalone entry to platform scope;
- tenant A cannot read, update, delete, or link to tenant B's entry/override;
- a platform default remains visible to every otherwise-authorized tenant;
- tenant A's override wins only in tenant A; tenant B still sees the default or
  tenant B's own override;
- deleting/reverting an override exposes the default and does not mutate it;
- bulk replace, route-norm full-list operations, and CSV import cannot erase or
  rewrite platform defaults;
- platform updates preserve all tenant overrides byte-for-byte;
- startup/reset never clone platform defaults into every tenant;
- generic create/update/bulk payloads cannot supply `companyId`, `tenantId`, or
  `platformDefaultId` and cannot change stable physical/logical identity;
- duplicate override links, dangling links, partial scope, missing authoritative
  scope, cross-collection links, and unscoped rows carrying an override link fail
  closed;
- platform default deletion is blocked while an override exists;
- logical work/part/module/route references resolve the correct effective row;
- external-photo archive and demo reset cannot mutate a platform default;
- current 399 platform records and any existing exact-tenant standalone records
  remain byte-for-byte unchanged during classification/activation.

## 7. Required code changes after field authorization

1. Add an explicit mixed scope category/policy for exactly the eight collections.
2. Implement validated raw partitioning, effective read projection, and dedicated
   tenant override create/revert operations.
3. Split platform and tenant mutation authority; preserve the non-target
   partitions byte-for-byte with CAS/concurrency protection.
4. Replace mixed-catalog generic array persistence and dedicated deactivate/bulk
   paths with partition-aware operations.
5. Update access control so content-role authorization is separate from record
   origin; a readable default is not tenant-mutable.
6. Make relationship resolution, service, bot, reports, workload, diagnostics,
   and frontend consumers operate on the effective projection only.
7. Make tenant CSV import tenant-partition-only and keep platform import disabled
   until a stable-ID manifest lifecycle exists.
8. Keep normal startup free of catalog writes; keep reset/backup preservation and
   update their policy descriptions/coverage.
9. Rebuild the Stage 4 future-write inventory/matrix and re-run independent
   Stage 2-6 audits on final unchanged hashes.

## 8. Migration and compatibility checkpoint

- SQL/schema migration: **none proposed**.
- Current production data migration for these eight families: **none**.
- Existing proven unscoped rows: remain byte-for-byte and become platform
  defaults after an exact read-only activation preflight.
- Existing exact-tenant rows without `platformDefaultId`: remain tenant
  standalone entries.
- Automatic linking/backfill by name, title, article, route endpoints, category,
  or array position: **forbidden**.
- New persistent JSON field: **authorized**. `platformDefaultId` is optional and
  may appear only on an exact-tenant override linked to an existing unscoped
  default in the same family.
- Backward-compatibility risk: **high before the raw-consumer refactor; medium
  after complete effective-read routing and adversarial coverage**.
- Destructive migration: **not required and not proposed**.
- Reconstruction implementation can continue without another business decision:
  **YES**, within the authorized optional JSON-field representation. The
  higher-risk same-ID composite identity alternative remains out of scope and
  would require a separate explicit decision.
- Authorization recorded: 2026-08-31. It does not authorize SQL schema changes,
  destructive migration, mass row rewriting, a change to the existing public
  ID contract, Stage 7, or any production action.
