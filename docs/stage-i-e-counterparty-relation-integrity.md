# Stage I-E — Counterparty Relation Integrity

## Canonical boundary

`server/lib/counterparty-relations.js` is the single integrity boundary for the current migration scope:

- customer-specific relation: `record.clientId -> Client.counterpartyId -> Counterparty`;
- role-neutral relation: `record.counterpartyId -> Counterparty`;
- names, registration identifiers, phones, email and addresses never select a relation target;
- duplicate stable IDs are corruption, not a reason to choose the first record.

The machine-readable audit covers `counterparties`, `clients` and `client_objects`. Counts in `summary.healthy`, `summary.repairable` and `summary.broken` are audit entries; `summary.scanned` contains collection row counts.

## Audit taxonomy

| Class | Meaning | Repairability |
| --- | --- | --- |
| H1 | `Client.counterpartyId` uniquely resolves to an active Counterparty with `customer` role | none needed |
| H2 | Counterparty-only `ClientObject.counterpartyId` uniquely resolves; archived Counterparty is allowed only for an archived object | none needed |
| H3 | Both ClientObject IDs resolve and `Client.counterpartyId === ClientObject.counterpartyId` | none needed |
| R1 | ClientObject has a unique `clientId`, its Client has a unique valid `counterpartyId`, and the object lacks only `counterpartyId` | deterministic ID-chain repair |
| B1 | `Client.counterpartyId` target is missing | never automatic |
| B2 | `ClientObject.clientId` target is missing | never automatic |
| B3 | `ClientObject.counterpartyId` target is missing | never automatic |
| B4 | ClientObject `clientId` and `counterpartyId` disagree | never automatic |
| B5 | A customer-specific relation targets a Counterparty without `customer` role | never automatic |
| B6 | Stable relation ID is absent; only legacy metadata may be present | never automatic |
| B7 | Stable identity is absent or duplicated, so the target/record is ambiguous | never automatic |
| B8 | An active relation targets an archived Counterparty | never automatic |

Existing resolver codes remain authoritative (`...CLIENT_NOT_FOUND`, `...COUNTERPARTY_NOT_FOUND`, `...MISMATCH`, `...CUSTOMER_ROLE_REQUIRED`, `...COUNTERPARTY_ARCHIVED`, and related required-ID codes). I-E adds `COUNTERPARTY_RELATION_CANONICAL_ID_MISSING`, `COUNTERPARTY_RELATION_AMBIGUOUS`, and `COUNTERPARTY_RELATION_REPAIR_FAILED` for states that had no precise existing code.

## Repair contract

`repairCounterpartyRelations({ readData, writeDataBatch, dryRun })` always audits first. It returns `changed`, `skipped`, `failed`, the complete `audit`, and counts.

The only mutation is:

```text
client_objects[i].counterpartyId = resolved Client.counterpartyId
```

It does not create Client/Counterparty records, add roles, alter identity, unarchive records, delete links, overwrite mismatch, or consult metadata. A second run is a no-op.

The operator command defaults to dry-run:

```bash
node server/scripts/counterparty-relation-integrity.js --dry-run
node server/scripts/counterparty-relation-integrity.js --apply
```

`--apply` creates a SQLite backup before the first relation write and must run in a maintenance window with application writes stopped. Startup retains the authoritative I-D R1 backfill and then runs a read-only audit; it does not add any new repair heuristic.

## Legacy lookup inventory

The following paths were inventoried but intentionally not migrated in I-E.

| Location | Domain | Behaviour | Category | Risk | Future stage |
| --- | --- | --- | --- | --- | --- |
| `server/routes/debt-collection-plans.js:findClient` | Debt collection | Falls back from missing/unresolved `clientId` to `Client.company`, then persists the selected `clientId` | relation recovery/write | critical: first duplicate name can become a durable false link | Debt collection migration |
| `server/routes/crud.js:serviceRentalBelongsToClient` | Service | Validates a rental/client pair by names when the rental lacks `clientId` | relation validation | high: duplicate/renamed client can approve or reject the wrong link | Service migration |
| `server/routes/crud.js:rentalBelongsToClient` | Rentals/client deletion | Finds linked rentals by client name when rental `clientId` is absent | protective delete guard | medium: conservative false positive/negative; does not write a relation | Rentals migration |
| `server/routes/crud.js:recordBelongsToClient` | Documents, payments, delivery, service, CRM, debt | Finds history links by display names for Client deletion protection | protective delete guard | medium: may block or miss deletion protection after rename | Per-domain migration |
| `server/routes/tasks-center.js:clientPlanKey` | Tasks/debt | Uses normalized name as a plan/debt dedupe key when ID is absent | workflow grouping | high: same-name clients can suppress a required task | Debt collection migration |
| `server/lib/receivables-core.js:clientKey` | Receivables/debt | Groups debt rows, documents, actions and plans by name when ID is absent | financial grouping | critical: debt/history can be merged across same-name clients | Finance migration |
| `server/lib/finance-core.js:getRentalDedupeKey` | Finance/reports | Uses client display label inside the legacy fallback dedupe key | dedupe fallback | medium: incomplete legacy rentals may collapse | Rentals/finance migration |
| `server/routes/gsm.js:buildGsmBinding` | GSM | Uses rental/equipment client text only as a display fallback after ID lookup | read/display | low: no canonical link is written | GSM cleanup |
| `server/lib/bot-notifications.js:findClientName` | MAX bot | Resolves by ID and otherwise keeps the supplied name as notification text | display fallback | low: notification can show stale text; no relation recovery | Bot/display cleanup |
| `server/lib/manager-my-plan.js:clientNameForRecord` | Manager plan | Resolves name by ID, then falls back to stored snapshots | display fallback | low | Display cleanup |
| `server/lib/client-relations.js:buildClientObjectDebtBreakdown` | Client object finance view | Uses Client-by-ID first and row label as display fallback | display fallback | low | Finance/display cleanup |
| `src/app/pages/Settings.tsx:handleGanttImport` | Rental CSV import | Finds a Client by exact company name and writes its ID into imported rentals | relation recovery/write | critical: duplicate/renamed names select the wrong Client | Rentals migration |
| `src/app/pages/Settings.tsx:handleClientsImport` | Client import | Uses normalized INN to decide which persisted Client is overwritten | identity merge/write | high: explicit import workflow, but still metadata-based identity selection | Counterparty import stage |
| `src/app/lib/rental-new-route.js` + `src/app/pages/RentalNew.tsx:clientRouteResolution` | Rental creation | Legacy route client label is resolved to the first matching Client and becomes form `clientId` | relation recovery/write | critical | Rentals migration |
| `src/app/pages/RentalDetail.tsx:selectedClient` | Rental edit/detail | Falls back to company name, then scopes object/contract options and quick actions with that Client ID | relation recovery/UI write context | high | Rentals migration |
| `src/app/pages/Documents.tsx:quickActionClient` | Documents | Converts quick-action `clientName` into Client ID and pre-fills document creation | relation recovery/write context | critical | Documents/contracts migration |
| `src/app/pages/Documents.tsx:relatedRentalOptions` | Documents | Treats equal rental/client labels as related for option filtering | relation filtering | high | Documents/contracts migration |
| `src/app/pages/Payments.tsx` quick-action effect | Payments | Converts a client-name context into a Client-ID list filter | read/filter | medium: wrong results for duplicate names; does not itself persist a link | Payments migration |
| `src/app/pages/Deliveries.tsx` active-rental mapping | Deliveries | Fills delivery draft `clientId` from the first Client with matching company name | relation recovery/write context | critical | Deliveries migration |
| `src/app/pages/Deliveries.tsx` form selector | Deliveries | Accepts ID or company label and selects the first match | relation selection/write context | high | Deliveries migration |
| `src/app/pages/Deliveries.tsx:renderDeliveryPanel` and table | Deliveries | Uses a name-indexed Client only to show INN/details when `clientId` is absent | display enrichment | medium: can display another same-name client's data | Deliveries/display cleanup |
| `src/app/components/service/ServiceTicketForm.tsx:rentalBelongsToSelectedClient` | Service | Uses rental/client labels to keep or clear a rental link when rental `clientId` is missing | relation validation/write context | high | Service migration |
| `src/app/pages/ServiceDetail.tsx:relatedClient` | Service | Falls back to company name for related Client display | read/display | medium: wrong Client card context is possible | Service migration |
| `src/app/pages/Service.tsx:getTicketClientDetails` | Service | Uses a name lookup to enrich legacy ticket display with INN | display enrichment | medium: can expose the wrong same-name Client's INN | Service/display cleanup |
| `src/app/pages/ClientDetail.tsx` | Client 360/debt | Includes rentals and debt plans by normalized name when `clientId` is absent | read/grouping | high: history/debt can appear under the wrong Client | Client 360/debt migration |
| `src/app/lib/client360.js:sameClient` | Client 360 | Joins rentals, documents, payments and debt rows by company name for legacy rows | read/grouping | critical: cross-domain history can be merged | Client 360 migration |
| `src/app/lib/debtCollectionPlans.js:uniqueClientKey` | Debt collection UI | Groups debt rows and plans by normalized client name without ID | read/grouping | high | Debt collection migration |
| `src/app/lib/notifications.ts` debt warning | Notifications | Associates rental debt by client label when both rows lack `clientId` | read/alert relation | high: false or missing financial alert | Finance/notifications migration |
| `src/app/lib/equipment360.js:clientDebtForRental` | Equipment 360 | Finds the Client debt record by company name when rental `clientId` is absent | read/risk relation | high | Equipment/finance migration |
| `src/app/pages/Dashboard.tsx` blocked-client alert | Dashboard | Associates active rentals to blocked clients by company name without ID | read/alert relation | high | Rentals/dashboard migration |
| `src/app/pages/Rentals.tsx` debt client count | Rentals dashboard | Uses `clientId || client label` as a distinct-client key | read/grouping | medium | Rentals/finance migration |
| `src/app/components/gantt/RentalDrawer.tsx` | Rental drawer | Falls back to rental client label for Client and receivable selection | read/action context | high | Rentals/finance migration |
| `src/app/lib/gsm.ts:buildRentalBinding` | GSM map | Looks up Client by name to derive manager/address for an operational map binding | operational read enrichment | high: wrong address/manager can be displayed | GSM migration |
| `src/app/components/ui/ClientCombobox.tsx:selectedClient` | Shared client picker | Falls back to the first equal display label when `valueId` is absent | UI selection | medium: ambiguous visual selection can feed a later action | Shared UI cleanup |
| `src/app/lib/globalSearch.js` | Global search | Uses Client-by-ID first and stored client text only as result subtitle fallback | display fallback | low | Display cleanup |

Reviewed non-relation uses:

- Counterparty name/INN search and duplicate checks are search/validation diagnostics, not automated relation recovery.
- `server/lib/client-inn.js` uses INN only to enforce Client uniqueness, not to repair domain links.
- `server/lib/client-links.js` explicitly refuses name/INN matching; its only permitted legacy repair chain is `rentalId -> rental.clientId`.
- The reports route has no direct name-to-ID resolver; current report risk is inherited from finance/receivables grouping helpers listed above.
- No direct name/INN relation recovery was found in the CRM route modules; CRM risk remains in shared deletion/history and Client 360 paths.
