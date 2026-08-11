# Stage I-GC — Counterparty Integration Checkpoint

Дата проверки: 2026-08-11

Архитектурный verdict: **READY FOR COUNTERPARTY CHECKPOINT COMMIT**

Git verdict для текущего накопленного worktree: **DO NOT COMMIT YET** — архитектура Counterparty готова, но один commit всего worktree смешал бы её с отдельной программой Rental Creation / lifecycle и другими ранее накопленными изменениями.

Machine-readable inventory и evidence находятся в [`stage-i-gc-counterparty-integration-audit.json`](./stage-i-gc-counterparty-integration-audit.json).

## 1. Baseline после I-B–I-G

```text
Counterparty.id                         canonical business/legal identity
    ^
    | Client.counterpartyId             unique customer-profile compatibility link
    |
Client.id
    ^
    | Rental.clientId                   customer-workflow compatibility (when applicable)
    |
Rental.counterpartyId ----------------> Counterparty.id   canonical
    |
    +--> Gantt Rental                   stable-ID projection; Classic Rental authoritative
    |
    +--> Payment.rentalId

Payment.counterpartyId ---------------> Counterparty.id   canonical
Payment.clientId ----------------------> Client.id         optional compatibility
Payment allocations / receivables / debt / reports        derived from stable IDs
```

Если у Rental или Payment одновременно присутствуют `counterpartyId` и `clientId`, `clientId` обязан разрешаться в ту же Counterparty. `client`, `clientName`, `company`, `legalName`, ИНН, телефон и адрес остаются display/search/validation metadata и не восстанавливают relation в мигрированных write paths. Supplier и contractor могут иметь Payment без искусственного Client.

## 2. Integration inventory

Проверено 45 surfaces: 37 production и 8 non-production.

| Домен | Production | Non-production | Всего | Проверенный boundary |
| --- | ---: | ---: | ---: | --- |
| Counterparty | 4 | 0 | 4 | identity, roles, archive, frontend/API |
| Client | 5 | 0 | 5 | unique `counterpartyId`, CRUD/bulk/delete, Client 360 |
| Rental | 8 | 0 | 8 | create/patch/bulk/import/lifecycle/change requests/UI |
| Gantt | 2 | 0 | 2 | projection write and frontend reconciliation |
| Payment | 5 | 0 | 5 | CRUD/bulk/change requests/allocations/UI |
| Finance | 6 | 0 | 6 | receivables, debt, cash flow, reports, snapshots |
| Security | 2 | 0 | 2 | stable-ID scope and mutation allowlists |
| System/import | 2 | 0 | 2 | system-data import and legacy sync |
| Persistence | 1 | 0 | 1 | shared write boundary |
| Startup | 1 | 0 | 1 | audit-only behavior |
| MAX/bot | 1 | 0 | 1 | derived Rental lifecycle usage |
| Migration tools | 0 | 3 | 3 | Counterparty/Client, Rental, Payment scripts |
| Seed | 0 | 1 | 1 | deterministic fixture relations |
| Tests | 0 | 3 | 3 | focused/backend/E2E coverage groups |
| Documentation | 0 | 1 | 1 | I-B–I-G architecture artifacts |
| **Итого** | **37** | **8** | **45** | |

Полный per-surface реестр содержит domain, location, relation field, classification, read/write, production flag, risk, expected invariant, actual state и required action в JSON-аудите.

## 3. Найденные и закрытые нарушения

| ID | Invariant | Location | Severity | Root cause | Resolution |
| --- | --- | --- | --- | --- | --- |
| V01 | Startup не мутирует identity | `server/lib/startup.js`, `server/server.js` | Critical | foundation repair был подключён к каждому startup и мог создавать Counterparty/roles | identity repair удалён из startup; оставлены read-only audits |
| V02 | Каждый Payment write проходит canonical resolver | `server/routes/rental-change-requests.js` | Critical | применение одобренной корректировки писало sanitized patch напрямую | полный candidate canonicalized до атомарной записи, relation errors структурированы |
| V03 | Canonical ID имеет приоритет в authorization | `server/lib/access-control.js` | Critical | `counterpartyId OR clientId` расширял scope при конфликте | при наличии `counterpartyId` scope проверяется только по нему; `clientId` — fallback только для legacy record без canonical ID |
| V04 | Route prefill не превращает display name в FK | `src/app/pages/RentalNew.tsx` | High | legacy query text сопоставлялся с `Client.company` | разрешён только явный `clientId`; legacy text требует ручного выбора |
| V05 | Rental consumers не восстанавливают Client по имени | RentalDetail, RentalDrawer, ClientDetail, Client360, Dashboard | High | profile/debt/Rental enrichment группировал по snapshot names | оставлены Counterparty ID precedence и Client ID compatibility |
| V06 | Gantt остаётся stable-ID projection | `src/app/pages/Rentals.tsx`, `RentalDetail.tsx` | Critical | normalized company-name matcher выбирал Classic Rental | fuzzy matcher удалён; reconciliation использует Counterparty ID или Client ID только при отсутствии canonical ID с обеих сторон |
| V07 | Classic→Gantt не теряет canonical identity | `src/app/pages/Rentals.tsx` | High | projection constructors не переносили `counterpartyId` | `counterpartyId` добавлен в обе projection paths |
| V08 | Relation collections не допускают missing/duplicate IDs | `server/lib/access-control.js`, bulk routes | High | generic full replacement проверял relations, но не уникальность entity IDs | clients/rentals/gantt_rentals/payments отклоняют missing и duplicate IDs до persistence |
| V09 | Archive не ломает active Rental relation | `server/routes/counterparties.js` | High | guard не видел direct Counterparty-only Rental | archive блокируется active Classic/Gantt reference; terminal history разрешена |
| V10 | Historical read отделён от active write | Rental/Payment audits | Medium | archived target всегда считался broken, включая историю | terminal Rental и сохранённый Payment audit допускают archived target; mutation resolvers остаются strict |

Все 10 подтверждённых нарушений закрыты. Неразрешённых invariant violations в migration scope I-B–I-G нет. Финансовая арифметика не менялась.

## 4. Targeted fixes и доказательство

1. Startup identity mutation отключена. Это безопасно, потому что удалена только неявная запись; operator-run migration tools и read-only diagnostics сохранены. Доказательство: `tests/startup-safety.test.js`.
2. Payment correction change request теперь вызывает `canonicalizePaymentCounterpartyRelation`. Invalid mismatch возвращает 409 и не меняет Payment/request. Доказательство: `tests/api-security-routes.test.js`.
3. Rental authorization следует canonical Counterparty precedence. Legacy `clientId`-only record остаётся совместимым. Доказательство: `tests/security-access-control.test.js`.
4. Rental/Gantt frontend больше не восстанавливает relation по имени и переносит `counterpartyId` в projection. Доказательство: `tests/rental-counterparty-relations.test.js`, `tests/client360.test.js`, production build.
5. Critical bulk collections требуют непустые уникальные stable IDs. Invalid full replacement отклоняется до write. Доказательство: `tests/security-access-control.test.js`, `tests/payment-counterparty-relations.test.js`, API security tests.
6. Archive guard и audits различают active relation и historical read. Доказательство: Counterparty, Rental relation и Payment relation tests.

## 5. Legacy identity lookup audit

Production usages классифицированы так:

- Display snapshots: Payment/Rental DTO labels, `finance_operations.counterparty`, `company_expenses.counterparty`. Сохранены как текст, не FK.
- Search/discovery: `legalName`, `shortName`, ИНН, телефон в Counterparty search. Сохранены; write relation не создают.
- Validation/dedup diagnostics: legal identifiers и названия. Сохранены; ambiguity не разрешается автоматически.
- Derived/reporting: unlinked receivable/report buckets по snapshots. Сохранены как явно unlinked output, не canonical identity.
- Compatibility: `clientId`, customer profile labels, conservative legacy deletion guards. Сохранены только на обозначенных boundaries.
- Unsafe identity fallbacks внутри уже мигрированных Rental/Gantt цепочек: удалены из RentalNew, Rentals, RentalDetail, RentalDrawer, ClientDetail, Client360 и Dashboard.

Оставшиеся name-based paths в Documents/Contracts, Delivery, Service, GSM и debt-collection compatibility обнаружены и задокументированы, но не переписаны: эти домены ещё не объявлены migrated Counterparty relation domains. Их metadata не должна использоваться новыми Counterparty write paths; перенос выполняется отдельными bounded stages.

## 6. Migration и startup status

Все проверки выполнены только в dry-run на `server/data/app.sqlite`; apply не запускался, backup не требовался, база не изменялась.

| Домен | Command | Scanned | Healthy | Repairable | Broken | Changed / skipped / failed | Wrote |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Counterparty/Client/Object | `node server/scripts/counterparty-relation-integrity.js --db server/data/app.sqlite` | CP 0 / Clients 0 / Objects 0 | 0 | 0 | 0 | 0 / 0 / 0 | false |
| Rental | `node server/scripts/rental-counterparty-relations.js --db server/data/app.sqlite` | Rentals 0 | 0 | 0 | 0 | 0 / 0 / 0 | false |
| Payment | `node server/scripts/payment-counterparty-relations.js --db server/data/app.sqlite` | Payments 0 | 0 | 0 | 0 | 0 / 0 / 0 | false |

Рабочая база пуста по этим collections, поэтому dry-run подтверждает non-mutating execution, но не заменяет test fixtures для classification/repair. Скрипты deterministic, stable-ID based, idempotent, имеют dry-run/apply separation, backup/transaction для apply и не используют fuzzy/name/ИНН inference, automatic entity creation или role mutation.

Startup выполняет только read-only integrity audits и не запускает repair даже при legacy maintenance flag.

## 7. Security closure

- Backend scoping опирается на stable Rental/Counterparty/Client IDs; display metadata не используется для authorization.
- Unknown roles/collections остаются deny-by-default в существующем access layer.
- `counterpartyId` и `clientId` разрешены только в нужных mutation contracts и проходят resolver; frontend validation не считается boundary.
- Bulk replacement для ключевых relation collections не принимает missing/duplicate entity IDs.
- Conflicting `counterpartyId`/`clientId`, missing Counterparty/Client link и active write к archived Counterparty отклоняются.
- Historical terminal Rental и записанный Payment могут читать archived Counterparty; новый active write не может создать такую relation.
- Supplier/contractor Payment без Client разрешён и не создаёт fake Client.

## 8. Verification evidence

| Check | Result |
| --- | --- |
| Focused Counterparty/Client/Rental/Payment/migration/access/startup/API suite | 175 tests, 175 passed, 0 failed |
| Focused Client360/Rental frontend relation suite | 21 tests, 21 passed, 0 failed |
| Full backend `npm test` | 3061 tests, 3061 passed, 0 failed, 0 skipped, 0 cancelled, 0 todo |
| Production frontend `npm run build` | success, 3392 modules transformed, 7.19 s |
| Counterparty roles E2E | 1 test, 1 passed, 0 failed, 2.9 s |
| `git diff --check` | exit 0 |
| JSON validation `jq -e` | exit 0 |
| Migration dry-runs | 3 commands, 0 writes, 0 failures |

## 9. Remaining compatibility debt

- Client остаётся persisted customer-role profile: `Client.id` и unique `Client.counterpartyId` нужны существующим customer workflows.
- Rental сохраняет `clientId` для customer compatibility; `client`/`clientName` — snapshots; `counterpartyId` authoritative.
- Payment сохраняет optional `clientId` для customer receivables; supplier/contractor flows используют direct `counterpartyId`.
- Receivables/debt могут группировать customer-profile data по `clientId`; unlinked snapshot buckets остаются явно неразрешёнными, а не угадываются.
- ClientObject имеет integrity support, но Objects/Contracts/Documents ещё не получили полный Counterparty relation contract.
- Service, Delivery и GSM сохраняют legacy Client/display metadata до отдельных migration stages.
- `finance_operations.counterparty` и `company_expenses.counterparty` остаются display snapshots; Accounts Payable не проектировался.

## 10. Следующая граница

Следующий логический bounded stage: **Stage I-H — Documents & Contracts Counterparty Relations**.

Он должен отдельно определить canonical IDs, historical/archive behavior, DTO/forms/navigation, imports и deterministic audit для Documents/Contracts. Delivery, Service/GSM и receivables/debt compatibility должны оставаться отдельными последующими boundaries. Реализация I-H в I-GC не выполнялась.

## 11. Git checkpoint boundary

Проверка выполнена на `main`, tracking `origin/main`, base `805ddb51`. Накопленный worktree включает как Counterparty I-B–I-G/I-GC, так и самостоятельные Rental Creation seven-stage/lifecycle changes, общие QA/E2E изменения и смешанные файлы (`server/routes/rentals.js`, `server/routes/system.js`, `RentalNew.tsx`, тестовые suites).

Поэтому нельзя безопасно фиксировать весь worktree одним Counterparty commit. Рекомендованная граница:

1. Counterparty identity/relation foundation, Client/Rental/Payment integration, deterministic audits, focused tests и Stage I docs.
2. Отдельный Rental Creation/lifecycle/async-recovery набор с его E2E и отчётом.
3. Остальные несвязанные QA/service/delivery изменения — по их собственным boundaries.

Из-за mixed-file overlap требуется patch-level staging и повторный `git diff --cached`, focused tests и build перед созданием commit. История не переписывалась, commit не создавался.
