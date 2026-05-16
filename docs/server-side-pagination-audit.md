# Server-side pagination audit

## Contract

Large list endpoints support an opt-in paginated mode with `paginated=true` so existing consumers that expect arrays keep working during migration.

Query params:

- `page`, default `1`
- `pageSize`, default `25`, allowed UI values `10`, `25`, `50`, `100`, backend max `100`
- `search`
- `sortBy`
- `sortDir=asc|desc`
- entity filters such as `status`, `managerId`, `clientId`, `equipmentId`, `ownerId`, `mechanicId`, `carrierId`, `type`
- date periods via `dateFrom` and `dateTo`

Response:

```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "pageSize": 25,
    "total": 0,
    "totalPages": 0,
    "hasNextPage": false,
    "hasPrevPage": false
  },
  "summary": {}
}
```

RBAC and collection scoping are applied before filtering, `total`, and `items`.

## Audit

| Section | Frontend file | Current API | Full list today | Client-side search/filter/sort | Backend move | KPI/dependencies | Role scope |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Equipment | `src/app/pages/Equipment.tsx` | `/api/equipment?paginated=true` | Partially removed | Search, status/type/owner/sale filters now sent to backend; detail context still reads related rentals/gantt/documents/service | Backend `search`, `status`, `type`, `ownerId`, `category`, `drive`, `location`, `activeInFleet`, `saleState`, sort, page | Fleet KPI cards and quick view still depend on related full arrays | Backend collection scope |
| Rentals | `src/app/pages/Rentals.tsx` | `/api/rentals`, `/api/gantt_rentals` | Yes | Rental list filters/page slice; fleet planner filters equipment/rentals locally | Backend `/api/rentals?paginated=true` exists, but workspace still needs a separate migration because timeline/list/KPI share the same full arrays | Rental drawer, timeline, utilization KPI | Backend rental scope |
| Fleet plan | `src/app/pages/Rentals.tsx`, `src/app/pages/Planner.tsx` | `/api/gantt_rentals`, `/api/planner/rows` | Yes | Timeline filters/grouping locally | Planner-specific paginated row endpoint; keep date window server-side | Conflict sets, equipment utilization | Planner access rules |
| Service | `src/app/pages/Service.tsx` | `/api/service` | Yes | Search, status, priority, scenario, mechanic, date locally | `/api/service?paginated=true` | Queue metrics, service detail | Service/mechanic scope |
| Warranty claims | `src/app/components/service/WarrantyClaimsTab.tsx` | `/api/warranty_claims` | Yes | Status/equipment/client/factory/responsible/period locally | `/api/warranty_claims?paginated=true` | Warranty metrics | Collection read scope |
| Deliveries | `src/app/pages/Deliveries.tsx` | `/api/deliveries` | Yes | Search/status/type/carrier/period tabs locally | `/api/deliveries?paginated=true` | Delivery board counts, carrier tasks | Carrier scope and terminal-status hiding |
| Clients | `src/app/pages/Clients.tsx` | `/api/clients` | Yes | Search locally | `/api/clients?paginated=true` | Client cards/counts | Client scope |
| Documents | `src/app/pages/Documents.tsx` | `/api/documents?paginated=true`; bounded refs while forms are open | No for main registry; reference sets bounded/lazy except `gantt_rentals` | Registry filters on backend; wizard references limited to pageSize 100 | Keep entity-specific autocomplete as next step | Registry KPI, document control rows | Document read scope |
| Payments | `src/app/pages/Payments.tsx` | `/api/payments` | Yes | Search/status/client filters locally | `/api/payments?paginated=true` | Payment totals, allocations | Finance/payment permissions |
| Finance receivables | `src/app/components/finance/ReceivablesPanel.tsx` | `/api/finance/receivables` | Yes | Debt collection filters/sort locally | Add paginated finance receivables route preserving backend-scoped build | Receivables KPI/summary endpoint | Finance scope |
| Leasing | `src/app/components/finance/LeasingPanel.tsx` | `/api/leasing-contracts` | Yes | Search/status/company/equipment/overdue locally | Add paginated leasing route | Leasing summary endpoint | Finance/leasing scope |
| Expenses/operations | `src/app/pages/Finance.tsx` | `/api/company_expenses`, `/api/finance/operations` | Yes | Local filters in finance panels | Generic CRUD paginated mode for JSON collections | Finance KPI | Finance scope |
| Reports | `src/app/pages/Reports.tsx` | `/api/reports/mechanics-workload` | Yes for details | Detail filtering/sort in report UI | Report-specific detail pagination while summary remains aggregate | Workload/productivity KPI | Reports read scope |
| GSM packets | `src/app/pages/Gsm.tsx` | `/api/gsm/packets?paginated=true`, `/api/gsm/gateway/packets?paginated=true` | Removed for packet lists | Recent/selected packets bounded by page/pageSize | Paginated packets route | Telemetry snapshots still use equipment/rental refs | GSM view roles |
| GSM commands/connections | `src/app/pages/Gsm.tsx` | `/api/gsm/gateway/commands?paginated=true`, `/api/gsm/gateway/connections` | Removed for command lists; connections remain bounded in-memory gateway state | Local device filter sent to backend | Commands paginated; connections likely small | Gateway status | GSM view roles |
| Bot activity | `src/app/pages/BotDetail.tsx` | `/api/bots/:botId?paginated=true` | Removed for activity | Activity search/page sent to backend | Activity paginated inside bot detail payload | Bot summary/connections | Bot admin only |
| Admin dictionaries | `src/app/pages/AdminPanel.tsx`, settings pages | generic `/api/*` collections | Yes | Local table filtering | Use generic paginated mode for large dictionaries only | Admin counts | Admin/write rules |

## Backend implementation status

Implemented opt-in pagination for JSON-backed collections in generic CRUD, including `equipment`, `service`, `warranty_claims`, `clients`, `documents`, `payments`, `company_expenses`, and `finance_operations`.

Implemented opt-in pagination for dedicated routes:

- `/api/rentals?paginated=true`
- `/api/deliveries?paginated=true`
- `/api/gsm/packets?paginated=true`
- `/api/gsm/gateway/packets?paginated=true`
- `/api/gsm/gateway/commands?paginated=true`
- `/api/bots/:botId?paginated=true` for `activity`

Frontend migration status in this wave:

- `Equipment` registry now requests `/api/equipment?paginated=true` with list filters, but related context tabs still load full rentals/gantt/documents/service data.
- `Gsm` packet and command widgets now request paginated packet/command endpoints.
- `BotDetail` now requests paginated activity and keeps bot summary/connections in the same detail payload.
- `Documents` registry remains paginated and large reference collections are lazy/bounded to form/wizard open state. `gantt_rentals` still needs a bounded date/search reference endpoint.

Collections still stored in `app_data` are filtered and sorted on the backend, then sliced before response. Future high-volume candidates for normalized SQL tables with indexes: `gsm_packets`, `bot_activity`, `documents`, `payments`, `rentals`, `gantt_rentals`, `service`, `deliveries`.

## Remaining second-wave blockers

- `src/app/pages/Rentals.tsx` still loads `/api/rentals`, `/api/gantt_rentals`, `/api/equipment`, `/api/payments`, `/api/documents`, `/api/deliveries`, and `/api/service` as shared full arrays for timeline, list, returns, debt/docs, and drawer context.
- `src/app/pages/Planner.tsx` still loads `/api/planner` without a required date window.
- `src/app/pages/Gsm.tsx` still loads full equipment/rentals/gantt/clients refs to build dashboard snapshots; packet/command history is now bounded.
- `src/app/pages/Reports.tsx` still needs aggregate/detail separation and paginated detail endpoints.
- Detail pages such as `RentalDetail` and `EquipmentDetail` still use full related collections for history/context tabs.
