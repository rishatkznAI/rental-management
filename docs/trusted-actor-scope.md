# Trusted Actor Scope

## Invariant

Every newly created scoped entity must receive `companyId` and `tenantId` from trusted server-side actor context before persistence.

The scoped master-data boundary currently covers:

- Counterparty;
- CounterpartyRoleAssignment;
- SupplierProfile and ContractorProfile;
- Client;
- Client Object;
- Client Contract.

## Authoritative source

The authenticated principal remains the stable `users[].id`. Ownership is not read from fields on the JSON user record. The backend resolves exactly one active `company_memberships` row for that principal and then requires the referenced `canonical_companies` row to be active.

A principal with no active membership, more than one active membership, or an inactive/missing company has no complete actor scope. Authentication may still succeed for compatibility, but every scoped master-data read and write fails closed with `ACTOR_SCOPE_INCOMPLETE`.

Request bodies, query parameters, headers, frontend state, names, collection order, and a singleton-company observation are never scope authority.

## Tenant semantics

The current runtime domain model has no independent Tenant aggregate and no separate user-to-tenant membership. `Company` is the tenant security boundary: one tenant is exactly one canonical company, so authoritative `tenantId` is the authoritative `companyId`.

This is expressed centrally as the `company_is_tenant` model in `trusted-actor-scope.js`; it is not a default identifier. SaaS multi-company growth adds independent canonical Companies, each acting as its own tenant boundary. It does not add a second Tenant aggregate or an independently generated tenant ID.

## Session propagation

Login resolves scope on the backend and stores a scope snapshot in persistent `app_sessions`. On every authenticated request, middleware reloads the current user, live-resolves the active membership and company, and builds `req.actorScope`. The stored snapshot is used to detect a changed company/membership; client-returned values are not used.

Persistent sessions therefore keep scope across reloads, new requests, and backend restart. Membership removal, ambiguity, or ownership change removes usable scope for subsequent scoped reads and writes.

## Creation and mutation boundaries

Dedicated Counterparty creation and generic Client/Object/Contract creation reject public `companyId` or `tenantId`, require `req.actorScope`, and assign both fields immediately before normalization and persistence. Compatibility-created Counterparties inherit the already trusted Client scope. New role assignments and supplier/contractor profiles inherit their parent Counterparty scope.

Bulk replace, legacy sync, and system import require authenticated actor scope whenever scoped master data is present. New records receive that scope server-side. Existing records must already have matching scope, and their ownership is immutable.

Actor scope does not replace authorization. Backend authentication, collection/role permission checks, and actor-scope-to-entity-scope comparison remain separate requirements. An administrator from one company cannot read or mutate scoped master data owned by another company.

## Legacy policy

Unknown, partial, conflicting, cross-company, and cross-tenant entity scope remains fail-closed. This change neither adopts nor backfills legacy records. In particular, an unscoped legacy entity is not assigned to the current company merely because only one company exists.

The deterministic Client-to-Counterparty foundation helper also refuses an unscoped legacy Client. It may copy scope only when the Client is already fully scoped, and an explicitly linked Counterparty must have the same complete scope.

Legacy Master Data Scope Backfill remains a separate, evidence-based task that must establish ownership per record before writing it.

## System actor policy

Current HTTP import and sync operations use the authenticated administrator's trusted actor scope. A background job that creates scoped master data must supply an explicit server-side actor context derived from trusted job configuration and authoritative company/tenant membership. There is no anonymous or payload-derived system scope and no production bootstrap fallback.

The guarded demo seed is an explicit non-production system context. It creates the canonical `DEMO-COMPANY-001` authority and active memberships for its synthetic demo users, and all demo master data uses that company-as-tenant scope. Its existing demo-environment and demo-database guards remain mandatory.

The Playwright bootstrap is explicitly test-only (`NODE_ENV=test` plus `E2E_TRUSTED_SCOPE_BOOTSTRAP=1`) and seeds authority only in the disposable default E2E database. It is not used for an externally supplied database or normal server startup.
