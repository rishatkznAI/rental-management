# Stage J-E — Service Ticket Customer Counterparty Relations

## Architectural goal

Customer-bearing Service tickets now use `ServiceTicket.counterpartyId -> Counterparty.id` as their authoritative customer identity. A Client profile remains optional compatibility state. Legitimate internal maintenance tickets remain customerless.

## Before and after

Before Stage J-E, Service tickets primarily carried editable display fields such as `client`/`clientName`, with optional `clientId`, Rental, object, and contract context. Some frontend reads also looked up a Client by company name. The generic persistence layer did not independently enforce a complete Service customer invariant.

After Stage J-E, every Service write converges on `server/lib/service-counterparty-relations.js`. A customer relation is accepted only when stable IDs resolve uniquely and consistently. Display names, INN, phone, object labels, contract labels, and other snapshots never establish, repair, or retarget identity.

## Authoritative relation and stable derivation

The canonical relation is `ServiceTicket.counterpartyId -> Counterparty.id`. A customer relation may be supplied or deterministically completed from:

1. `counterpartyId` directly;
2. `clientId -> Client.counterpartyId`;
3. `rentalId -> Rental.counterpartyId` (Classic or Gantt collection, with an unambiguous exact stable ID);
4. `objectId -> ClientObject.counterpartyId`;
5. `contractId -> ClientContract.counterpartyId`.

Every supplied chain must resolve to the same Counterparty. Missing, ambiguous, or conflicting stable links fail closed. An active customer relation requires an existing, non-archived Counterparty with an active `customer` role. Historical terminal tickets retain their stable relation when the Counterparty is later archived or its customer role becomes inactive.

## Internal ticket semantics

An internal Service ticket is valid only when it has no customer stable relation and no customer snapshot metadata. Internal PDI, receipt, and fleet-maintenance workflows therefore remain valid without manufacturing a Counterparty or Client.

Customer display metadata without a stable relation is rejected on creation and active modification. A broken customer relation is not reclassified as internal.

## Compatibility fields

`clientId`, `rentalId`, `objectId`, and `contractId` remain optional. When present, each must resolve to the canonical Counterparty. `client`, `clientName`, `counterpartyName`, and `customerDisplayName` are presentation snapshots only.

Ordinary updates may fill a missing `counterpartyId` from an existing deterministic stable chain. Once a canonical relation exists, ordinary PATCH, Service-core, and bulk workflows cannot remove or retarget it.

## Mutation paths covered

- Global `writeData('service', ...)` and `writeDataBatch(...)` canonicalize the complete candidate Service collection before SQLite persistence.
- Generic `/api/service` create, patch, full/bulk replace, and delete paths use the same invariant. Bulk candidates are validated completely before the atomic batch write.
- Service-core status, revision, revision resolution, assignment, log, work, part, and lifecycle mutations preserve the relation.
- Rental return-with-damage propagates the Rental's canonical `counterpartyId` without changing Rental lifecycle behavior.
- Equipment receipt/PDI remains an internal ticket flow.
- MAX repair, maintenance, commercial work, and receiving/return inspection paths propagate stable Rental context when it exists; direct bot batches still pass through global persistence protection.

## Reads and frontend

Generic Service list/detail DTOs enrich customer display from `counterpartyId` and optional `clientId` only. They do not expand financial, document, or other private Client state. The frontend uses Counterparty-first selection, permits a Counterparty with no Client profile, filters optional Client/Rental/object/contract choices by `counterpartyId`, and visibly includes the stable Counterparty ID for same-name disambiguation. List/detail lookups no longer search Clients by company name.

## Import, export, CSV, and legacy sync

System Data export preserves Service stable relation fields. Dry-run and apply imports canonicalize the whole Service collection against staged prerequisites. Apply writes are atomic and ordered as Counterparties, role assignments, Clients, ClientObjects, ClientContracts, Rentals/Gantt Rentals, then Service.

Settings Service CSV appends `counterpartyId`, `clientId`, `rentalId`, `objectId`, and `contractId`. Legacy Service CSV that lacks the Counterparty-ID column is rejected because customer identity cannot be reconstructed safely from display labels.

Legacy `/api/sync` rejects a Service collection with `SERVICE_COUNTERPARTY_SYNC_DISABLED`; callers must use the canonical Service API or System Data import.

## Migration taxonomy and startup audit

`server/scripts/service-counterparty-relations.js` supports read-only dry-run and explicit apply. It reports:

- already canonical;
- deterministic repair;
- internal/unlinked valid;
- conflicting stable relations;
- missing referenced stable entity;
- missing Counterparty;
- archived Counterparty;
- missing/inactive customer role;
- metadata-only unresolved relation.

Apply creates a SQLite backup first, writes only deterministic stable-ID completions in one transaction, leaves unresolved rows unchanged, and is idempotent. It never matches names, INN, or phone.

Startup runs the same audit as an inspect/classify/report check and never repairs Service data. The separate Service `createdAt` backfill continues to spread existing records and therefore preserves all stable relation fields.

## Archive and customer-role blockers

For Service customer relations, the existing terminal states `ready`, `closed`, `completed`, `cancelled`, and `canceled` retain their IDs without blocking customer-role removal forever. Every other state—including the known active states `new`, `in_progress`, `waiting_parts`, and `needs_revision`—is treated as nonterminal and blocks Counterparty archival and customer-role removal. Blockers use the direct canonical ID and deterministic stable-ID chains so an older repairable ticket cannot bypass the guard before migration. This terminal-history exception is limited to Stage J-E customer-role semantics; Service contractor reference blockers retain their pre-J-E behavior, and contractor identity and lifecycle remain deferred.

## Authorization impact

No role matrix was widened. Existing Service readers remain readers and existing Service writers remain writers. Authorized Service creators may submit `counterpartyId`. Non-admin update field restrictions, mechanic assignment scope, backend collection authorization, and admin-only bulk rules remain intact. Relation validation is additional backend enforcement, not a frontend permission substitute.

## Explicit out of scope

Stage J-E does not redesign Rental lifecycle, Gantt, pricing, deposits, downtime, finance/AR/debt arithmetic, warranty manufacturer identity, field-trip contractors, GSM/telemetry, suppliers/vendors, CRM conversion, or equipment ownership. It adds no SQL schema or shadow index.

## Tests

Coverage includes every stable derivation chain, agreeing and conflicting chains, missing/archived/inactive targets, same-name safety, Counterparty-only and internal tickets, immutability, generic and Service-core mutations, global single/batch enforcement, archive/role blockers, Rental/PDI/MAX creation, read DTO safety, planner/readiness regressions, System Data and CSV behavior, legacy sync rejection, migration backup/apply/idempotency, startup read-only behavior, created-at preservation, demo seed semantics, and existing authorization suites.

## Remaining future Counterparty stages

Still separate and unsolved by J-E: Service field-trip contractors, warranty factories/manufacturers, GSM customer cleanup, suppliers and vendors, CRM prospect conversion, AR/debt architecture, and equipment ownership conversion.
