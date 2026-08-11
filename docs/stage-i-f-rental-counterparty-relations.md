# Stage I-F — Rental Canonical Counterparty Relations

## A. Rental relation inventory

### Authoritative writes

| Production path | Relation classification | Stage I-F behavior |
| --- | --- | --- |
| `POST /api/rentals` | Canonical ID relation plus compatibility Client relation | `clientId` is resolved only through `Client.counterpartyId`; matching explicit `counterpartyId` is accepted and conflicts are rejected. |
| `PATCH /api/rentals/:id` | Canonical ID relation | The complete candidate passes the same resolver before persistence. This covers admin edits and immediate manager-safe edits. |
| `PUT /api/rentals` | Bulk canonical ID relation | Every row passes the same resolver; staged system imports may resolve against staged Clients and Counterparties. |
| `POST /api/rentals/:id/extend` | Existing canonical relation plus lifecycle mutation | Classic Rental remains authoritative; persistence revalidates/canonicalizes the complete Rental list. |
| `POST /api/rentals/:id/return` | Existing canonical relation plus lifecycle mutation | Relation fields are preserved and revalidated; return/equipment/service semantics are unchanged. |
| Rental downtime create/update/cancel | Existing canonical relation plus lifecycle mutation | Relation fields are preserved and revalidated by the shared persistence boundary. |
| Rental delete and bulk removal | Lifecycle mutation | Does not establish a customer relation; linked Gantt cleanup still follows Classic Rental IDs. |
| Rental change-request approval | Canonical ID relation plus projection update | Approved Rental state is checked at persistence; change-request snapshots now carry `counterpartyId`. |
| Delivery date/status synchronization | Existing canonical relation plus lifecycle mutation | Classic Rental relation is preserved and checked; Gantt relation fields are re-derived from Classic Rental. |
| MAX shipping/receiving flows | Existing canonical relation plus lifecycle mutation | Classic and Gantt status changes pass through the same persistence guard. |
| Service-created Rental stop flow | Existing canonical relation plus lifecycle mutation | Closing Classic Rental preserves/canonicalizes the relation and projects it to Gantt. |
| Controlled system-data import | Bulk canonical ID relation | Import analysis canonicalizes Rentals against staged/current stable IDs and rejects broken chains before write. |
| Settings Rental CSV import | Bulk canonical ID relation | Requires stable Client, Counterparty, object, and contract IDs, then writes only Classic Rentals through `PUT /api/rentals`; Gantt/equipment remain server-derived projections. |
| Demo seed | Canonical ID relation | Seeded Rentals and their Gantt projections include `counterpartyId`. |
| Explicit Rental relation repair CLI | Deterministic repair | Only the stable `Rental.clientId -> Client.counterpartyId -> customer Counterparty` chain is repairable. |

All application writes to `rentals` and `gantt_rentals` also pass through the shared server persistence boundary. This covers indirect writers without duplicating relation logic in delivery, service, bot, and approval implementations.

### Reads and projections

| Read path | Classification |
| --- | --- |
| Rental list/detail/context APIs | `counterpartyId` and `clientId` are stable relation fields; `client`/`clientName` remain display/search snapshots. |
| Rental context related-record lookup | Compatibility Client relation by `clientId`; related records use `rentalId` and/or stable `clientId`. |
| Gantt linked rows | Derived/projection data. `counterpartyId`, `clientId`, and customer display snapshots are copied from authoritative Classic Rental. |
| Rental audit/history | Display-only snapshots and stable IDs; no relation recovery. |
| Equipment `currentClient`, conflict messages, bot notification labels | Display-only snapshots. |
| Finance/report consumers | Compatibility reads still primarily use `clientId`; these downstream domains are intentionally not migrated in I-F. |

### Customer fields copied from Rental

- Linked Gantt rows receive `counterpartyId`, `clientId`, `client`, and `clientName` from Classic Rental.
- Rental change requests retain `counterpartyId`, `clientId`, and the client display snapshot.
- Deliveries, service tickets, documents, payments, equipment state, and bot events continue to receive their existing compatibility IDs/display fields. Their canonical Counterparty migration remains downstream work.

### Legacy recovery inventory

- Rental route writes already disabled `normalizeRecordClientLink` name/INN recovery and Gantt fallback in mutation routes.
- Stage I-F removes fuzzy/name customer matching from Gantt-to-Classic resolution. Only stable customer IDs may participate in that fallback; direct Rental/Gantt IDs remain preferred.
- Settings Rental CSV import no longer maps the customer-name column to Client. Stable `ID клиента`, `ID объекта`, and `ID договора` columns are required; an explicit `ID контрагента` must agree with the Client chain. The importer no longer submits `gantt_rentals` as independent truth.
- Related-entity access scoping no longer matches a Rental through client/company display text.
- Service-to-Rental client validation no longer falls back to display names.
- Client deletion no longer declares a metadata-only Rental related by a name match. Such rows remain unresolved and unchanged for controlled audit/operator resolution.

## B. Architecture before / after

Before I-F, `Rental.clientId` was the durable compatibility link and display names still participated in a few import, Gantt fallback, access, and validation paths. Gantt stored independent customer fields.

After I-F:

```text
Classic Rental.counterpartyId -> Counterparty(customer)   [canonical]
Classic Rental.clientId       -> Client                   [compatibility]
Client.counterpartyId         -> same Counterparty        [required invariant]
Gantt customer fields         <- Classic Rental           [projection]
client/clientName             = display snapshots only
```

Classic Rental lifecycle and Classic-vs-Gantt authority are unchanged.

## C. Canonical resolution contract

Valid states:

1. `counterpartyId` uniquely resolves to an active customer Counterparty, with no Client required.
2. `clientId` uniquely resolves to a Client whose `counterpartyId` uniquely resolves to an active customer Counterparty; `Rental.counterpartyId` is derived.
3. Both IDs exist and resolve to the same Counterparty.

Machine-readable failures reuse the Stage I-E taxonomy:

- `COUNTERPARTY_RELATION_ID_REQUIRED`
- `COUNTERPARTY_RELATION_CLIENT_NOT_FOUND`
- `COUNTERPARTY_RELATION_CLIENT_LINK_MISSING`
- `COUNTERPARTY_RELATION_COUNTERPARTY_NOT_FOUND`
- `COUNTERPARTY_RELATION_CUSTOMER_ROLE_REQUIRED`
- `COUNTERPARTY_RELATION_COUNTERPARTY_ARCHIVED`
- `COUNTERPARTY_RELATION_AMBIGUOUS`
- `COUNTERPARTY_RELATION_MISMATCH`
- `COUNTERPARTY_RELATION_REPAIR_FAILED`

Names, INN, phone, address, contract text, and equivalent metadata are never resolver inputs.

## D. Migration / backfill

Run a read-only preview:

```bash
node server/scripts/rental-counterparty-relations.js --dry-run --db server/data/app.sqlite
```

Apply during a maintenance window:

```bash
node server/scripts/rental-counterparty-relations.js --apply --db server/data/app.sqlite
```

Apply mode creates a SQLite backup first. It changes only `Rental.counterpartyId` proven by a unique stable Client chain and updates already-linked Gantt projection fields in the same batch. It creates no Client or Counterparty. Missing, ambiguous, mismatched, archived, non-customer, and metadata-only rows remain unchanged and are reported. Re-running after a successful repair is a no-op.

Startup performs a read-only Rental relation audit. It does not apply Rental relation repair.

## E. Legacy lookups removed or quarantined

- Removed: Settings CSV `client name -> Client.id` lookup.
- Removed: Gantt fuzzy/normalized client-name compatibility matching.
- Removed: access-control Rental matching by client/company label.
- Removed: service mutation validation by Rental/client display names.
- Quarantined: metadata-only Rentals remain unresolved and unchanged; Client deletion does not assign them by name.
- Retained as display only: Rental search, labels, notifications, audit text, and equipment `currentClient` snapshots.

## F. Files changed for I-F

- `server/lib/rental-counterparty-relations.js` — Rental resolver, audit, canonical persistence transform, projection sync, and controlled repair.
- `server/scripts/rental-counterparty-relations.js` — dry-run/apply operator tool with backup.
- `server/server.js` — shared Rental/Gantt persistence enforcement and production route resolver injection.
- `server/routes/rentals.js` — create/update/bulk canonicalization and canonical projection fields.
- `server/lib/rental-change-requests.js` — stable relation matching and Gantt/change-request propagation.
- `server/routes/rental-change-requests.js` — treats `counterpartyId` as a Rental relation field.
- `server/routes/system.js` — staged import canonicalization.
- `server/routes/crud.js` — removes Rental/service name relation validation and prevents Client deletion from inferring Rental ownership from display metadata.
- `server/lib/access-control.js` — stable-ID-only scoped Rental matching.
- `server/lib/startup.js` — read-only Rental relation audit.
- `server/scripts/seed-demo-data.js` — canonical demo Rental IDs.
- `src/app/pages/Settings.tsx` — stable-ID CSV export/import and stable Classic-Gantt export lookup.
- `src/app/types.ts`, `src/app/mock-data.ts` — Rental/Gantt `counterpartyId` types.
- `tests/rental-counterparty-relations.test.js` — focused I-F contract coverage.
- `tests/rental-change-requests.test.js`, `tests/api-security-routes.test.js`, `tests/system-routes.test.js` — updated regression expectations for stable relations.

## G. Verification

- Focused Stage I-F: 16 passed, 0 failed.
- Rental change-request regression: 69 passed, 0 failed.
- API/security regression: 94 passed, 0 failed.
- Complete Node suite: passed (`npm test`, exit 0).
- Production build: passed (`npm run build`, 3,391 modules transformed).
- SQLite production-data dry-run: 0 Rentals scanned, 0 changed, 0 skipped, 0 failed; no writes performed.
- Focused Rental Playwright flow: 3 passed, 0 failed.
- The broad Playwright suite was also started because CSV frontend behavior changed. It reached 7 passes before three unrelated baseline/environment failures (`PRODUCTION_API_URL` absent, mechanic logout locator timeout, and an investor historical-date fixture rejected by existing lifecycle validation); the remaining run was stopped after those failures because no Settings CSV E2E exists.

## H. Remaining risks

- Finance, Documents, Deliveries, Service, CRM, Reports, bot events, and equipment projections still primarily consume `clientId` and display snapshots. Their own canonical Counterparty migrations are not part of I-F.
- Existing metadata-only Rentals remain unresolved by design and can block later operations that require a proven customer relation.
- Operator apply requires a maintenance window because the JSON collection persistence model has no per-record compare-and-swap across external processes.
- Some downstream read-only presentation helpers still contain legacy label fallbacks. They do not write Rental relations, but should be removed when those domains migrate to Counterparty.
