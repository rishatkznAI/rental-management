# Stage J-B — Counterparty Role/Profile Boundary

## Verdict and scope

Stage J-B makes role assignments explicit without renaming the compatibility `clients` collection or changing Rental, Gantt, Payment/AR, Document, Report, DeliveryCarrier, CRM, MAX, or GSM business flows.

`Counterparty.id` remains the only canonical legal/business identity. `Client.id`, `Rental.clientId`, `Rental.counterpartyId`, `Payment.clientId`, and `Payment.counterpartyId` retain their existing contracts.

## Pre-change inventory

The bounded inventory covered:

- Counterparty normalization, CRUD, role endpoints, Client projection, archive guards, authorization, frontend types/service;
- Client CRUD/bulk/system import, INN uniqueness, customer finance fields, objects/contracts, delete guards, Client 360 and reports;
- Rental create/edit/bulk/import, Gantt projection, change requests, canonical relation audit and repair;
- Payment create/edit/bulk/import, Counterparty decoration, allocation/AR/finance calculations;
- Documents/reports and customer-history deletion guards;
- `delivery_carriers`, carrier users, delivery DTOs, MAX carrier flows and carrier string snapshots;
- spare-part supplier strings, finance/company-expense text counterparties, seed/demo, system export/import, startup and SQLite `app_data` persistence.

Findings relevant to J-B:

- `Client` contains customer-specific payment terms, credit limit/policy inputs, manager, status, contacts/preferences and customer notes.
- `Client.company`, registration identifiers, addresses, email, phone and website are compatibility projections of Counterparty identity. `Client.notes` was incorrectly synchronized as identity and is now profile-specific.
- Rental and Payment already support direct Counterparty relations; supplier/contractor Counterparties do not require Client.
- `Counterparty.roles[]` was the role write authority and role removal guarded only a linked Client.
- supplier identity remains a string in `spare_parts.supplier`; carrier/company identity remains separate in `delivery_carriers` and delivery carrier snapshots. These are diagnostics-only legacy surfaces in J-B.
- customer durable history uses stable `counterpartyId` and/or `clientId` across Rentals, Payments, Documents, objects/contracts and related customer collections. No J-B relation is inferred by name, INN, phone or email.

## Final model and authority

```text
Counterparty.id                         canonical legal/business identity
    |
    +-- CounterpartyRoleAssignment      authoritative role lifecycle
    |      unique (counterpartyId, roleCode)
    |      roleCode: customer | supplier | contractor
    |
    +-- Client                          optional CustomerProfile compatibility
    |      unique counterpartyId; never required for supplier/contractor
    |
    +-- SupplierProfile                 exactly one per supplier Counterparty
    |
    +-- ContractorProfile               exactly one per contractor Counterparty
```

Collections:

- `counterparty_role_assignments`
- `supplier_profiles`
- `contractor_profiles`
- existing `clients` as the CustomerProfile compatibility implementation

An active `CounterpartyRoleAssignment` is authoritative. `Counterparty.roles[]` is an atomically maintained compatibility projection. Readers use assignment authority when assignments exist for that Counterparty and fall back to the legacy projection only for unmigrated records.

The CustomerProfile is optional during compatibility: a customer Counterparty may be used directly by stable ID without a synthetic Client. If a Client exists, its `counterpartyId` is unique and an active Client requires an active customer assignment. Supplier and contractor roles always require their dedicated active profile.

## Lifecycle invariants

1. Add is idempotent and atomically creates/reactivates the assignment, required supplier/contractor profile and roles projection.
2. Repeated add does not create another assignment or profile.
3. Removal deactivates the assignment and profile; it does not cascade-delete history.
4. Removing the last active role is rejected with `COUNTERPARTY_ROLE_REQUIRED`.
5. Customer removal is rejected with `COUNTERPARTY_ROLE_REMOVAL_BLOCKED` when any stable-ID Rental, Gantt, Payment/AR, allocation, Document, contract/object or other enumerated customer-domain reference exists. An unreferenced Client is archived/inactivated, not deleted.
6. Supplier/contractor removal checks their explicit stable fields. A direct Payment has no role-specific direction, so removal fails closed and reports that ambiguity.
7. Counterparty archive deactivates persisted assignments/profiles atomically after existing archive guards pass; the archived Counterparty retains its last role projection as a historical compatibility snapshot.
8. Role mutations accept only `role` plus optional `reason`/`source`; identity fields cannot be mass-assigned through that endpoint.

## Migration and startup

`server/scripts/counterparty-role-profile-integrity.js` is dry-run by default. Apply mode:

- requires explicit `--apply`;
- creates a SQLite backup first;
- derives assignments/profiles only from explicit Counterparty roles and stable `Client.counterpartyId`;
- writes all five boundary collections in one transaction;
- is idempotent;
- refuses duplicate IDs, duplicate profiles, missing stable targets and other ambiguous/corrupt input.

Startup runs the role/profile audit only. It never applies the migration, including when general startup business maintenance is enabled.

System import supports both legacy exports and J-B exports: after Counterparty/Client compatibility normalization it deterministically stages assignments/profiles and rejects a broken boundary before atomic persistence. System export includes all three new collections.

## Machine-readable diagnostics

The J-B audit reports:

- duplicate stable IDs;
- duplicate CustomerProfile, SupplierProfile and ContractorProfile records;
- duplicate `(counterpartyId, roleCode)` assignments;
- assignment/profile targets missing Counterparty;
- active role without required supplier/contractor profile;
- active profile without active role;
- missing `Client.counterpartyId` target and active Client without customer role;
- `Counterparty.roles[]` projection conflict;
- role-removal blockers with collection, stable record IDs and relation fields;
- ambiguous legacy supplier/carrier name mappings as report-only warnings.

Repairs never use name, INN, phone, email or display labels.

## Deliberately remaining legacy

- `Client` collection/API naming and customer screens remain unchanged.
- CustomerProfile remains optional for Counterparty-direct customer relations.
- `delivery_carriers` is not broadly migrated; carrier company strings do not create Counterparty identity.
- spare-part supplier strings and role-neutral finance display strings remain snapshots.
- Documents/contracts, CRM/contact redesign, Payment Approval/outgoing payments, bank reconciliation and broad permissions redesign remain out of scope for later stages.
