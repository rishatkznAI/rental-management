# Stage J-D — Delivery Customer & Carrier Counterparty Relations

Status: implemented on the Stage J-C main-line boundary. This stage is intentionally limited to Delivery customer identity and logistics-contractor identity.

## Boundary decision

The Stage I-GC checkpoint ranks Delivery Counterparty Relations immediately after Documents & Contracts. Stage J-B already reserved `deliveries.counterpartyId`, `deliveries.carrierCounterpartyId`, and `delivery_carriers.counterpartyId` as stable references while deferring carrier business identity. Therefore J-D owns:

- `Delivery.counterpartyId -> Counterparty(customer)`;
- optional compatibility `Delivery.clientId -> Client.counterpartyId`;
- `Delivery.carrierId -> DeliveryCarrier.counterpartyId -> Counterparty(contractor)`;
- the denormalized projection `Delivery.carrierCounterpartyId`.

This stage does not create a `Client` for a contractor. Names, INN, phone, email, addresses, and snapshots are never identity authority.

## Mutation and read rules

- New and active deliveries require a resolvable customer relation through direct stable IDs or an agreed rental/object/contract stable-ID chain.
- A carrier is optional, but when present both `carrierId` and its contractor Counterparty relation must resolve and agree.
- `counterparty_role_assignments` is the active role authority. Customer and contractor projections alone cannot authorize a new relation.
- Customer and carrier Counterparty links are immutable through ordinary update routes.
- Terminal deliveries and inactive carriers may retain archived historical projections, but conflicts and missing stable targets still fail closed.
- The specialized Delivery routes, generic DeliveryCarrier CRUD and bulk replacement, MAX bot creation, System Data import, and shared persistence wrappers use the same canonicalizers.
- Carrier DTO scoping remains operational: carrier users see only their own non-terminal tasks and receive no financial, document, or extra rental data.
- DeliveryCarrier deletion and bulk omission are blocked when stable delivery history references the record.
- Counterparty archival is blocked by active customer/carrier deliveries or an active DeliveryCarrier profile.

## Migration and startup

`server/scripts/delivery-counterparty-relations.js` is dry-run by default. It classifies every Delivery and DeliveryCarrier as `valid`, `repairable`, `conflicting`, or `unresolved`.

Only deterministic repairs from stable ID chains are allowed. Apply mode:

1. blocks on any conflicting or unresolved record;
2. creates a SQLite backup;
3. writes the affected JSON collections atomically;
4. is idempotent on repeat execution.

Startup runs the same audit read-only and logs non-valid records. It never performs business-data repair automatically. The current persistence model has no Delivery SQL shadow table, so there is no shadow index to synchronize.

## Import, export, sync, and demo data

- System Data export includes customer/carrier IDs and the supporting Counterparty, role, Client, object, contract, classic-rental, and Gantt-rental collections.
- System Data import canonicalizes role/profile foundations, rentals, carriers, then deliveries before its atomic batch write.
- Legacy `/api/sync` rejects `deliveries` and `delivery_carriers`; it cannot silently ignore or replace these canonical relations.
- Demo seed data includes a real contractor Counterparty, active contractor role assignment/profile, a linked DeliveryCarrier, and deliveries containing both customer and carrier Counterparty IDs.

## Compatibility inventory

Safe compatibility fields are `clientId`, `carrierId`, display snapshots, operational MAX/system-user bindings, and existing route/equipment/rental references. They remain useful but are not business identity authority.

Removed identity recovery paths include client/company name matching in Delivery create/prefill, editable-label INN display joins, manager-bot free-text customer entry, virtual carrier synthesis from bot/system users, and client deletion history checks by delivery name.

## Deferred boundaries

The following remain explicitly outside J-D and require separate stage decisions:

- Service, field-trip contractor, warranty, and GSM/telemetry relations;
- suppliers, spare parts, purchases, and vendor/expense identity;
- receivables, debt collection, accounts-receivable grouping, and report arithmetic;
- broader equipment service-history external organizations.

No J-D code should infer or persist those relations from Delivery snapshots.
