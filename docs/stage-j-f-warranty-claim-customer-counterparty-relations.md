# Stage J-F — Warranty Claim Customer Counterparty Relations

## Previous model

Warranty claims previously relied on optional `serviceTicketId`, `clientId`, customer display labels, and equipment/factory context. No central boundary made one customer identity authoritative, and generic persistence/import paths could store inconsistent relations.

## Canonical authority

The authoritative customer relation is:

`WarrantyClaim.counterpartyId -> Counterparty.id`

`CounterpartyRoleAssignment` is authoritative for the active `customer` role. `Counterparty.roles[]` is used only through the Stage J-B compatibility helper when no authoritative assignments exist.

The only allowed derivation chains are exact stable IDs:

- `WarrantyClaim.serviceTicketId -> ServiceTicket.counterpartyId -> Counterparty.id`
- `WarrantyClaim.clientId -> Client.counterpartyId -> Counterparty.id`
- `WarrantyClaim.rentalId -> Rental/Gantt Rental.counterpartyId -> Counterparty.id`
- direct `WarrantyClaim.counterpartyId -> Counterparty.id`

All supplied chains must resolve uniquely and agree. Missing, duplicated, broken, or conflicting stable references fail closed. Names, INN, phone, email, address, equipment state, inventory/serial numbers, and fuzzy matching never establish or repair customer identity.

## Active, terminal, and internal claims

Active and unknown statuses require a real, non-archived Counterparty with an active customer assignment. `approved` and `parts_shipping` remain active.

Only `closed`, `completed`, `done`, `rejected`, and `declined` are terminal history. Existing terminal history may retain a real archived Counterparty or inactive customer assignment, but missing targets and conflicts remain invalid. Reopening restores active-target requirements. The generic API cannot create new terminal history against a target that is already archived or role-inactive.

A claim is validly internal/customerless only when it has neither a customer stable relation nor customer snapshot metadata. A genuinely internal Service ticket and an equipment-only claim may remain internal. A missing Service ticket is broken, not internal. `factoryName` and `manufacturer` alone never make a claim customer-bearing.

## Mutation and authorization

Once persisted, `counterpartyId` cannot be removed or retargeted by ordinary updates. `serviceTicketId`, `clientId`, and `rentalId` may change only when the resulting chains still identify the established Counterparty. An internal claim may establish its first customer relation through a valid stable chain.

When `serviceTicketId` is created or changed, authorization is evaluated against the target Service ticket. Ordinary mechanics retain Service-derived scope; Warranty mechanics retain their existing broader visibility. Canonicalization runs after input sanitization and does not grant new Client or Counterparty access.

## Persistence, CRUD, import, and sync

The shared `writeData`/`writeDataBatch` boundary canonicalizes Warranty after Rental, Delivery, and Service prerequisites. Generic POST, PATCH, DELETE, and bulk PUT use the same invariant. Bulk collections require non-empty unique claim IDs, and mixed batches are validated before atomic persistence.

System Data exports `warranty_claims`, including canonical `counterpartyId`. Import stages Counterparties, role assignments, Clients, Rentals/Gantt Rentals, Service, and then Warranty. The complete Warranty candidate collection is canonicalized only after its sources are staged. Legacy `/api/sync` rejects Warranty replacement explicitly.

Generic reads decorate claims with the stable Counterparty ID and safe display labels only. Pagination filtering supports canonical `counterpartyId`; `clientId` remains compatibility-only. Same-name parties remain distinct because filter values use stable IDs.

## Role removal and archive blockers

Active canonical Warranty claims and deterministic legacy claims resolved through Service/Client/Rental stable chains block customer-role removal and Counterparty archival. Terminal Warranty history does not block either operation. This exception is narrowly scoped to the customer role and `warranty_claims`; supplier and contractor blockers are unchanged.

## Audit classifications

The read-only audit assigns every claim exactly one state:

- `already_canonical`
- `deterministic_repair`
- `internal_unlinked_valid`
- `canonical_terminal_history`
- `conflicting_stable_relations`
- `ambiguous_stable_id`
- `missing_referenced_entity`
- `source_relation_missing`
- `missing_counterparty`
- `archived_active_target`
- `customer_role_required`
- `metadata_only_unresolved`

Startup runs this audit without repairing data. System Control Center exposes scanned, canonical, internal, terminal-history, repairable, and broken counts.

## Repair contract

`node server/scripts/warranty-claim-counterparty-relations.js` is dry-run by default. `--apply`:

1. re-reads and fingerprints all Warranty relation inputs;
2. stops if any invalid claim exists;
3. creates a SQLite backup;
4. rechecks the fingerprint;
5. atomically adds only missing deterministic `WarrantyClaim.counterpartyId` values.

It never rewrites source IDs, names, statuses, decisions, history, factory fields, or equipment references. A second apply is a no-op.

## Explicit non-goals and deferred boundaries

Stage J-F does not change Rental/Gantt lifecycle or repair tooling, Warranty workflow decisions, finance/Payment/AR/debt, procurement/suppliers, GSM, CRM, equipment ownership, or broad RBAC.

Factory/manufacturer identity remains unresolved and explicitly outside Stage J-F. No `factoryCounterpartyId`, supplier/manufacturer canonicalization, or factory contact matching is introduced. Other deferred Counterparty boundaries remain unchanged.
