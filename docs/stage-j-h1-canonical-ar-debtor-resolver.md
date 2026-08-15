# Stage J-H1 — Canonical AR Debtor Resolver

## Scope and authority

Stage J-H1 introduces a pure, deterministic backend resolver and a read-only audit CLI. It does not connect the resolver to any production read or write path.

The identity invariant is:

```text
Counterparty.id       = canonical legal/business identity
                      = canonical AR debtor identity

Client                = optional customer profile and compatibility layer
Client.counterpartyId = stable Client -> Counterparty relation
```

Client rename, deactivation, or absence does not create a different debtor. Counterparty lifecycle and customer-role state are diagnostics around an already established stable identity; they never retarget it.

## Permitted stable identity sources

The resolver accepts only the following repository-authorized chains:

1. `record.counterpartyId -> Counterparty.id`;
2. `record.clientId -> Client.counterpartyId -> Counterparty.id`;
3. `record.rentalId -> Rental.counterpartyId -> Counterparty.id`;
4. legacy Rental compatibility: `record.rentalId -> Rental.clientId -> Client.counterpartyId -> Counterparty.id`;
5. `record.paymentId -> Payment.counterpartyId -> Counterparty.id`;
6. Payment compatibility already permitted by the repository: `Payment.clientId -> Client.counterpartyId` and `Payment.rentalId -> Rental` using the two Rental chains above;
7. `record.documentId -> Document.counterpartyId -> Counterparty.id`;
8. `record.contractId -> ClientContract.counterpartyId -> Counterparty.id`;
9. `record.objectId -> ClientObject.counterpartyId -> Counterparty.id`.

All supplied stable chains are evaluated. A linked Document, ClientContract, or ClientObject must contain its own canonical `counterpartyId`; J-H1 does not invent another transitive recovery chain behind those records. Rental's documented legacy Client chain and Payment's existing stable compatibility relations are the only compatibility exceptions.

## Forbidden identity sources

The following values can appear only in diagnostic display snapshots and never establish, merge, repair, or select identity:

- name or normalized name;
- legal/display/customer/client/company name;
- INN, KPP, OGRN, or other registration metadata;
- phone;
- email;
- address or arbitrary display metadata.

Same-name Clients and Counterparties remain distinct. The resolver never searches for the first matching Client or Counterparty by a label.

## Classification taxonomy

| Status | Meaning |
|---|---|
| `canonical` | A canonical Counterparty was resolved through one or more stable canonical relation targets. |
| `legacy_resolved` | Identity was resolved only through an allowed Client compatibility chain. |
| `counterparty_only` | The record contains one direct `counterpartyId` and needs no Client profile. |
| `matching_dual_id` | Canonical and Client compatibility chains are both present and resolve to the same Counterparty. |
| `unresolved` | No permitted stable identity exists, or a supplied non-Client relation cannot produce identity. |
| `mismatch` | Stable chains produce different Counterparty IDs. No candidate is selected. |
| `ambiguous` | A referenced stable ID or audited record ID has multiple matches. No candidate is selected. |
| `orphan_client` | A supplied Client stable ID has no matching Client record. |
| `orphan_counterparty` | A stable chain produces a Counterparty ID that has no matching Counterparty record. |

Resolved statuses are `canonical`, `legacy_resolved`, `counterparty_only`, and `matching_dual_id`. The other statuses block a future production dry-run or cutover until separately investigated.

## Fail-closed behavior

- Explicit `counterpartyId = X` plus `clientId -> X` returns `matching_dual_id`.
- Explicit `counterpartyId = X` plus `clientId -> Y` returns `mismatch`, with `counterpartyId: null`.
- Client-only stable identity returns `legacy_resolved`.
- Counterparty-only identity remains valid without manufacturing a Client.
- Multiple equal stable candidates resolve; multiple different candidates return `mismatch`.
- Duplicate stable targets return `ambiguous` even if their display metadata is identical.
- Missing Client and Counterparty targets return `orphan_client` and `orphan_counterparty` respectively.
- A missing Rental, Payment, Document, ClientContract, or ClientObject target is `unresolved` with a deterministic relation-target issue.
- Name-only records remain `unresolved`.

Lifecycle and role diagnostics are non-binding. Inactive Client profiles, archived Counterparties, and inactive customer roles can be reported without erasing or rebinding a historic stable debtor identity.

## Resolver result contract

`resolveArDebtorIdentity(record, data)` returns:

- `status`;
- resolved `counterpartyId` or `null`;
- sorted unique `candidateCounterpartyIds`;
- deterministically sorted `sourceRelations`;
- sorted unique `legacyClientIds`;
- deterministic structured `issues`, each marked blocking or non-blocking;
- lifecycle, active customer-role, customer-profile, and display-snapshot metadata.

The function reads input collections only. It has no clock, randomness, database dependency, repair behavior, or persistence write.

## Audit aggregation and CLI

`auditArDebtorIdentities(data)` audits the current AR runtime sources and collection workflows:

- `rentals`;
- `gantt_rentals`;
- `payments`;
- `payment_allocations`;
- `debt_collection_plans`;
- `debt_collection_actions`;
- `receivable_payment_plans`.

Documents, contracts, objects, Clients, and Counterparties are stable relation targets for those records; they are not automatically reclassified as AR records. The audit returns sorted per-record results, counts for every status, all issues, and a separate blocking-issue list. It does not mutate the input.

The only J-H1 runtime consumer is:

```bash
node server/scripts/ar-debtor-identity.js
node server/scripts/ar-debtor-identity.js --json
node server/scripts/ar-debtor-identity.js --db /path/to/app.sqlite --json
```

The CLI opens SQLite with `readonly: true`, only selects JSON from `app_data`, and exposes no apply, repair, or backfill option.

## Historic debt principle

Once historic AR evidence has a stable Counterparty relation, Client display-name changes, Client deactivation, Counterparty profile changes, or customer-role changes do not silently change the debtor. Lifecycle concerns are reported separately and require an explicit later-stage business decision; they do not authorize identity recovery by metadata.

## Non-goals

J-H1 deliberately makes none of the following changes:

- AR grouping migration from `Client.id` to `Counterparty.id`;
- billing, downtime, effective payment amount, allocation, outstanding, overdue, aging, due-date, manual-debt, report-period, or cash-flow arithmetic;
- Finance, Dashboard, Reports, Tasks Center, notifications, Client 360, or collection-workflow runtime integration;
- API, DTO, or UI changes;
- collection schema migration;
- backfill, repair, merge, or deletion;
- writing `counterpartyId` into debt workflow collections;
- SQL canonical receivables migration or cutover;
- canonical Payment/Allocation/Adjustment changes;
- the separate cross-Counterparty allocation safety hotfix.

## Next gate

Stage J-H2 must not begin until this read-only audit produces an understood, production-safe inventory of unresolved, mismatching, ambiguous, and orphan identity records. J-H1 itself never fixes those records.
