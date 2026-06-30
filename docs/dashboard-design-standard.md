# Dashboard Design Standard — rentCore

**Document status:** mandatory product/design standard
**Applies to:** rentCore Dashboard / `Дашборд` / `Операционный центр`
**Audience:** Codex, AI agents, frontend engineers, product designers, reviewers
**Primary file target:** `docs/dashboard-design-standard.md`
**Integrated standards:** setup-banner removal, service load calculation, delivery load calculation

---

## 1. Purpose

This document defines the permanent visual, product and technical standard for the rentCore Dashboard.

The Dashboard is the face of rentCore. It must not be treated as a normal admin page, a debug screen, or a collection of random charts. It is the first screen that should sell the value of the product to owners, directors, commercial managers and operational teams.

Every future Dashboard change must follow this document.

If another prompt, task, or implementation idea conflicts with this document, this document is the source of truth unless the product owner explicitly approves a new standard.

---

## 2. Core Principle

The rentCore Dashboard must always be:

> **A premium B2B SaaS operational cockpit for managing an equipment rental business.**

It must combine four qualities:

```text
Beautiful + Expensive-looking + Clear + Operationally useful
```

The Dashboard must help the user understand, within 5 seconds:

1. Where the money is.
2. What is happening with the equipment fleet.
3. Where service is slowing the business down.
4. Which returns, deliveries, payments, documents or technical issues require attention.
5. What needs to be done today.

---

## 3. Product Positioning

rentCore must look stronger than:

- Excel trackers;
- 1C-style operational screens;
- generic CRM dashboards;
- cheap admin panels;
- internal-only engineering tools;
- overloaded sci-fi dashboards that look impressive but do not help manage a business.

The desired first impression:

> “This is a serious business control system. I can show this to an owner, investor or director.”

The Dashboard must sell the product visually and functionally.

---

## 4. Non-Negotiable Rules

### 4.1. The Dashboard must not become boring

Do not simplify the Dashboard into a flat, empty, low-value admin interface. Simplicity is acceptable only if it increases clarity while preserving premium visual quality.

### 4.2. The Dashboard must not become decorative noise

Do not create visual effects that look impressive but do not improve decision-making.

### 4.3. The Dashboard must not show a huge `N/A` as the main visual element

A giant central `N/A`, oversized radial placeholder or empty decorative circle is forbidden.

### 4.4. Empty data must look intentional

When data is missing, the Dashboard must explain the missing source and next action **inside the relevant block**. It must look like a smart local empty state, not like a broken or dead screen.

A wide global setup banner under the KPI row is forbidden on the main Dashboard.

### 4.5. Production smoke compatibility must be preserved

Existing production selectors and layout contracts must be preserved unless explicitly replaced with updated tests and approved.

---

## 5. Current Problem Pattern to Avoid

The Dashboard must not regress into either of these two bad states:

### Bad State A — Noisy sci-fi dashboard

Symptoms:

- too many grids, glows, decorative lines;
- oversized radial visuals;
- impressive but hard to read;
- visual elements take more space than their business value;
- the user cannot immediately understand what to do.

### Bad State B — Dead dark admin panel

Symptoms:

- too much black empty space;
- many cards say only “Нет данных”;
- KPI cards are visually weak;
- charts look empty and abandoned;
- no premium feeling;
- the screen no longer sells the product.

The target is neither A nor B.

The target is:

> **Premium operational clarity.**

---

## 6. Visual Style Standard

### 6.1. Target style

```text
Premium dark B2B SaaS
```

The style must feel:

- modern;
- expensive;
- technical;
- executive;
- calm;
- readable;
- alive;
- polished.

### 6.2. Background

Use a deep premium dark background, not pure black.

Recommended directions:

```text
Deep graphite
Dark emerald
Dark navy
Soft black-green gradient
```

The background should create depth without visual noise.

### 6.3. Cards

Cards should feel designed, not just bordered boxes.

Use:

- soft elevated surfaces;
- subtle gradients;
- controlled borders;
- slight depth;
- readable spacing;
- premium accent strips or small highlights where useful.

Avoid:

- hard flat black cards;
- too many thin borders;
- excessive glow;
- decorative frames without purpose.

### 6.4. Glow and visual effects

Glow is allowed only as a restrained accent.

Allowed:

- small status glows;
- soft active-state highlights;
- subtle data emphasis.

Forbidden:

- full-screen sci-fi grids;
- excessive neon lines;
- decorative shine that reduces readability;
- animated effects that distract from business information.

---

## 7. Color System

Recommended color direction:

```text
Background primary:      #07100F / #081112
Background secondary:    #0D1718 / #101C1D
Card background:         rgba(18, 29, 30, 0.86)
Card elevated:           rgba(24, 38, 39, 0.92)

Accent lime:             #A3FF35
Accent teal:             #45F0D0
Accent cyan:             #5DDCFF
Warning amber:           #FFCC66
Danger coral:            #FF6B6B

Text primary:            #F2F7F4
Text secondary:          #AAB8B2
Text muted:              #6F807A
Border subtle:           rgba(163, 255, 53, 0.12)
Border active:           rgba(163, 255, 53, 0.35)
```

### Color meanings

| Color | Meaning |
|---|---|
| Lime / green | OK, active, healthy, positive action |
| Teal / cyan | neutral technology accent, live data |
| Amber | warning, missing data, attention required |
| Coral / red | critical risk, overdue, failure |
| Gray-green | secondary information |

Color must communicate state. It must not be random decoration.

---

## 8. Typography Standard

### 8.1. KPI values

KPI values must be large and strong.

Good example:

```text
Утилизация парка
85%
В аренде 17/20
```

Bad example:

```text
Утилизация парка
0%
small unreadable explanation somewhere below
```

### 8.2. Hierarchy

Every block must have a clear hierarchy:

1. Section title.
2. Main value / status.
3. Short explanation.
4. Action or source.

### 8.3. Small text

Small text is allowed only for supporting metadata.

Important business meaning must not depend on tiny text.

---

## 9. Layout Structure

The Dashboard desktop layout should follow this structure:

```text
Sidebar
Main Dashboard Area

Main Dashboard Area:
1. Header / Hero
2. KPI Row
3. Main Operational Grid
4. Analytics / Executive Blocks

A separate wide setup / data completeness banner under the KPI row is not allowed on the main Dashboard.
```

The Dashboard must look like a complete control panel, not a random group of cards.

---

## 10. Sidebar Standard

The left sidebar should include:

- RentCore logo;
- search;
- navigation sections;
- active item highlight;
- theme/user controls if applicable.

Navigation items may include:

- Дашборд;
- Центр задач;
- Техника;
- GSM;
- База знаний;
- Продажи;
- Доставка;
- Аренды;
- Планировщик;
- Сервис;
- Служебные машины;
- Клиенты;
- Документы;
- Платежи;
- Финансы;
- Зарплата;
- Бот;
- Отчёты;
- Панель администратора.

The active Dashboard item must be clearly highlighted with a premium lime/green accent.

---

## 11. Header / Hero Standard

### Title

```text
Операционный центр
```

### Subtitle

```text
Пульт управления арендным бизнесом · июнь 2026 · 01.06.2026 — 30.06.2026
```

### Right-side chips

Examples:

```text
Обновлено 15:13
Недостаточно данных
Данные полные
```

### Visual requirements

The header must feel like the entrance to a premium command center:

- subtle gradient;
- clean status chips;
- good spacing;
- strong title;
- no heavy decorative noise.

---

## 12. KPI Row Standard

The KPI row is one of the most important sales and management areas.

### Recommended KPI cards

The Dashboard should support these KPI cards:

1. Просроченная дебиторка.
2. Утилизация парка.
3. Техника в аренде.
4. Выручка / поступления месяца.
5. Загрузка сервиса — calculated by service hours vs mechanic capacity, not by request count.
6. Доставки сегодня — calculated by daily delivery plan, completed deliveries and logistics risk.
7. Возвраты сегодня.
8. Просроченные ТО / критические задачи.

The visible count may adapt to screen width, but desktop should show the most important 5–7 cards.

### KPI card requirements

Each KPI card should include:

- title;
- large value;
- short explanation;
- state indicator;
- small trend/progress/accent visual.

### KPI examples

```text
Утилизация парка
85%
В аренде 17/20
```

```text
Выручка за июнь
1.2M ₽
Поступления и начисления за период
```

```text
Просроченная дебиторка
Нет данных
Проверьте начисления и финсинхронизацию
```

### KPI anti-patterns

Do not:

- show only “Нет данных” without reason;
- make the card look broken;
- use tiny text for important meaning;
- make normal, risky and missing states visually identical;
- calculate service load by request count only;
- calculate delivery status by total records only without daily plan/completion/risk.

---

## 13. Data Completeness / Setup Banner Rule

### 13.1. Decision

The Dashboard must **not** show a separate wide information banner with the text:

```text
Дашборд ещё собирает управленческую картину
```

This banner must not appear on the main Dashboard in demo state, insufficient-data state, partial-data state, or production state.

### 13.2. Reason

The Dashboard is the face of rentCore. The first screen must feel like a premium operational cockpit, not like a setup screen or warning page.

A wide setup banner under the KPI row reduces product value because it:

- takes a high-value position immediately below the KPI row;
- creates the feeling that the system is “not ready”;
- makes the screen less sales-oriented;
- duplicates information that should be shown inside specific business blocks;
- distracts from the main management metrics.

### 13.3. New principle

Missing data must be explained **locally inside the relevant block**, not through one general full-width banner.

Correct:

- no payments — explain inside “Динамика месяца” or KPI “Поступления месяца”;
- no rentals — explain inside “Загрузка техники”;
- no service requests — explain inside KPI/block “Загрузка сервиса”;
- no deliveries — explain inside KPI/block “Доставки сегодня”;
- no documents — explain inside “Здоровье компании” or “Задачи сегодня”.

Incorrect:

```text
Дашборд ещё собирает управленческую картину
```

as a general wide banner on the main Dashboard.

### 13.4. What should remain

Local compact empty states must remain.

Examples:

```text
Нет поступлений за месяц.
Проверьте раздел Платежи, связь платежей с клиентами/арендами и выбранный период.
```

```text
Активных сервисных заявок нет.
Мощность сервиса свободна.
```

```text
Доставок сегодня нет.
План логистики на день пуст.
```

```text
Парк есть, активных аренд сейчас нет.
Проверьте свободные единицы и ближайшие брони.
```

### 13.5. Where overall data status is allowed

Overall data status is allowed only in compact form:

- small chip in the header, for example `Недостаточно данных`;
- short status inside “Здоровье компании”;
- not as a separate full-width banner across the main work area.

### 13.6. Forbidden

It is forbidden to return a separate wide Dashboard banner with texts like:

```text
Дашборд ещё собирает управленческую картину
Начните с аренды и платежа, чтобы оживить аналитику
Техника — есть, Аренды — нет, Платежи — нет...
```

This information may be useful in onboarding, settings, demo mode, tooltip, or a help panel, but not as a persistent large block on the main Dashboard.

### 13.7. Acceptance criteria

This rule is satisfied only if:

1. The Dashboard no longer has a separate setup banner under KPI.
2. Header and KPI are visually closer to the main working area.
3. Overall data status remains only as a compact chip or inside “Здоровье компании”.
4. Empty states remain inside specific blocks.
5. The user still understands exactly which data is missing and where.
6. The Dashboard looks more premium and less like a first-time setup screen.
7. Responsive layout is not broken on desktop/tablet/mobile.
8. Horizontal overflow = 0.
9. Production selectors are not broken.
10. Backend/API/RBAC/db/schema/storage are unchanged.



## 14. “Главные сигналы сегодня” Block

This is the main attention block.

### Required heading contract

```text
Главные сигналы сегодня
```

### Subtitle

```text
Что требует внимания сейчас
```

### Signal row structure

Each signal should show:

- priority;
- risk object;
- reason;
- deadline or overdue period;
- action.

Example:

```text
Просрочено плановое ТО
JLG K1932
001 · 6 дней просрочки
Действие: Контроль
```

### Visual requirements

This block must look stronger than ordinary informational cards.

Use:

- severity indicators;
- clear action chips;
- clean rows;
- no cramped text;
- no decorative overload.

---

## 15. “Задачи сегодня” Block

### Purpose

Shows the daily operational cycle.

### Required task categories

- Возвраты сегодня;
- Доставки сегодня;
- Платежи сегодня;
- Сервис сегодня;
- Документы сегодня.

### Row structure

Each row must include:

- icon;
- label;
- short explanation;
- count;
- status.

Example:

```text
Возвраты сегодня
План возвратов пуст
0
```

### Anti-patterns

Do not show a list of meaningless zeros without explanation.
### 15.1. Delivery row calculation

The “Доставки сегодня” row must follow the Delivery Load Calculation Standard in section 30.

Short rule:

```text
Доставка сегодня = дневной план + факт закрытия + статус выполнения + риск логистики
```

Good display:

```text
Доставки сегодня
Закрыто 4 из 5 · в пути 1
4/5
```

Risk display:

```text
Доставки сегодня
1 просрочена · 1 не принята перевозчиком
2/5
```


---

## 16. “Динамика месяца” Block

### Purpose

Shows financial and operational movement for the month:

- charges;
- payments;
- overdue amounts;
- revenue;
- utilization if useful.

### If data exists

Use a polished chart:

- bar + line combination if appropriate;
- readable legend;
- clear scale;
- no excessive grid noise.

### If no data exists

Show a premium empty state.

Example:

```text
Нет поступлений за месяц

Проверьте раздел Платежи, связь платежей с клиентами/арендами и выбранный период.

Источник: Платежи · Аренды · Клиенты
```

### Anti-patterns

Do not:

- leave a large empty dark chart area;
- show a chart with no meaningful data;
- write only “Нет поступлений”.

---

## 17. “Загрузка техники” Block

### Purpose

Shows current fleet state.

### Required states

- В аренде;
- Свободно;
- В сервисе;
- На доставке;
- Общая загрузка.

### Recommended visual format

Use:

- utilization bar;
- compact circular indicator if useful;
- status distribution;
- mini trend if available.

### Empty / low-data case

If equipment exists but there are no active rentals, show:

```text
Парк есть, активных аренд сейчас нет.
Проверьте свободные единицы и ближайшие брони.
```

### Anti-patterns

Do not:

- create a huge donut without business value;
- leave the block empty;
- make 0% look like a technical failure.

---

## 18. “Возраст дебиторки” Block

### Purpose

Financial risk module.

### If data exists

Show aging buckets:

- 0–7 дней;
- 8–14 дней;
- 15–30 дней;
- 30+ дней.

### If there is no overdue debt

Show a positive state:

```text
Просроченной дебиторки нет
Финансовый контур чистый
```

### If data is missing

Show an explanation:

```text
Нет данных по дебиторке.
Просрочка не считается: нет строк задолженности.
Проверьте начисления, закрытые аренды и финансовую синхронизацию.
```

### Anti-patterns

Do not leave a large empty black area.

---

## 19. “Здоровье компании” Executive Module

This is the key executive module.

### Purpose

Shows business health by direction:

1. Деньги.
2. Парк техники.
3. Сервис.
4. Документы.
5. Доставка.

### Top section

Required title:

```text
Здоровье компании
```

Required overall status examples:

```text
Данные полные
Недостаточно данных
Есть риски
Всё стабильно
```

Required explanation example:

```text
Нет базы для полного расчёта: нужны записи из платежей, аренд, сервиса, документов и доставок.
```

### Data completeness strip

Example:

```text
Есть: Техника · Нет: Аренды, Платежи, Сервис, Документы, Доставка
```

### Direction card structure

Each direction card must include:

- icon;
- status;
- short reason;
- action;
- 2–3 key numbers if available.

Example:

```text
Деньги
Нет данных
Нет зарегистрированных платежей
Действие: откройте Платежи и проверьте ввод оплат
```

### Visual requirements

This block must look like an executive control panel, not a debug table.

Use:

- compact direction cards;
- scan-friendly structure;
- clear badges;
- strong but restrained accents;
- premium surface and depth.

### Forbidden

Do not use:

- huge central `N/A`;
- large decorative radial without purpose;
- text-heavy paragraphs;
- tiny text for key meaning.

---

## 20. Empty State Standard

Every empty state must answer four questions:

1. What is missing?
2. Why can’t the metric be calculated?
3. Where does the data come from?
4. What should the user do next?

### Good empty state

```text
Нет поступлений за месяц

Проверьте раздел Платежи, связь платежей с клиентами/арендами и выбранный период.
```

### Bad empty state

```text
Нет данных
```

### Visual standard

Empty states must be visually intentional:

- compact;
- clear;
- premium;
- action-oriented;
- not visually dead.

---

## 21. Demo Data / Sales Mode

For sales, screenshots, presentations and product demos, the Dashboard must support a rich visual state.

### Recommended demo state

```text
Утилизация парка: 85%
Техника в аренде: 17/20
Выручка за июнь: 1.2M ₽
Загрузка сервиса: 95%
Доставки сегодня: 4/5
Возвраты сегодня: 2/3
Просроченные ТО: 1
```

### Important rule

Demo data must never silently replace real production data.

It may exist only as:

- explicit demo mode;
- mock preview;
- seed data for local/demo environment;
- storybook/design preview if available.

---

## 22. Responsive Requirements

### Desktop 1440+

- full dashboard grid;
- KPI row visible and strong;
- main blocks aligned;
- no horizontal overflow.

### Tablet 768

- KPI cards wrap cleanly;
- main blocks stack or resize gracefully;
- text remains readable;
- no clipped controls.

### Mobile 390

- cards stack vertically;
- KPI values remain readable;
- charts do not break;
- sidebar behavior must be appropriate;
- no horizontal overflow.

Mandatory rule:

```text
horizontal overflow = 0
```

---

## 23. Production Compatibility

Dashboard is covered by production smoke tests. Do not break existing contracts without explicit approval.

### Required selectors

Preserve:

```text
dashboard-radial-overview
dashboard-radial-core
dashboard-radial-empty
dashboard-radial-node
dashboard-company-health
```

### Required geometry contract

```text
radialNodesInside = true
```

Meaning:

- radial nodes must be DOM descendants of `dashboard-radial-overview` or otherwise physically inside its bounds;
- `dashboard-radial-core` must be inside the overview;
- `dashboard-radial-empty` must be inside the overview when rendered;
- compatibility selectors must not be placed on hidden elements outside the overview bounds.

### Important

The old visual radial design does not need to return. A compact compatibility layer is acceptable, but it must preserve production smoke geometry.

---

## 24. Technical Scope Rules

### Default rule

Dashboard visual changes must be frontend-only unless explicitly approved.

### Allowed scope

```text
src/app/pages/Dashboard.tsx
src/app/pages/dashboard/*
src/app/components/dashboard/*
src/styles/theme.css — only if necessary and cross-page checked
tests/dashboard*.test.js
e2e/dashboard*.spec.ts
e2e/production-dashboard*.spec.ts
```

### Forbidden without explicit approval

```text
server/**
API routes
RBAC/auth
database/schema/storage/migrations
business formulas
unrelated pages
```

Unrelated pages include:

- Equipment;
- Rentals;
- Service;
- Payments;
- Finance;
- Admin;
- Bot;
- Reports;
- Clients;
- Documents.

---

## 25. Required Checks Before PR

Run:

```bash
git diff --check
npm run build
node --test tests/dashboard-attention.test.js tests/dashboard-company-health-ui.test.js tests/dashboard-metrics.test.js tests/dashboard-overdue-status.test.js
npx playwright test e2e/dashboard-layout.spec.ts
```

If `src/styles/theme.css` changed, also run:

```bash
npm test
```

And perform cross-page smoke:

- Dashboard;
- Equipment;
- Rentals;
- Service;
- Payments;
- Finance;
- Admin.

Cross-page smoke must check:

- page renders;
- no crash;
- no horizontal overflow;
- main cards/tables/forms readable;
- buttons and filters are not displaced;
- console/API blockers = 0.

---

## 26. Acceptance Criteria

A Dashboard PR can be accepted only if all of the following are true:

1. Dashboard looks like premium B2B SaaS.
2. Dashboard sells rentCore as a serious product.
3. KPI cards are visually strong and readable.
4. Empty states look like smart onboarding, not errors.
5. Company Health looks like an executive module.
6. No huge `N/A` is used as the main visual element.
7. No empty black holes are left on the screen.
8. No noisy sci-fi visuals are used.
9. The screen does not look like a cheap admin panel.
10. Responsive layout works at 1440 / 768 / 390.
11. Horizontal overflow = 0.
12. Production selectors are preserved.
13. `radialNodesInside = true`.
14. Backend/API/RBAC/db/schema/storage are untouched unless explicitly approved.
15. Unrelated pages are not broken.
16. Business meaning is not hidden in tiny text.
17. Dashboard remains operationally useful, not only visually attractive.

---

## 27. Codex / AI Agent Report Format

Every Dashboard-related PR must report in this format:

```text
STATUS: PR_READY / NEEDS_MORE_WORK

PR:
Branch:
Commit:

Root cause:
- ...

Changed files:
- ...

What changed:
- ...

Design improvements:
- Header:
- KPI cards:
- Critical signals:
- Tasks:
- Month dynamics:
- Fleet load:
- Receivables:
- Company health:
- Empty-data/setup mode:

Production compatibility:
- dashboard-radial-overview:
- dashboard-radial-core:
- dashboard-radial-empty:
- dashboard-radial-node:
- dashboard-company-health:
- radialNodesInside:
- key-signals heading:

Tests:
- git diff --check:
- npm run build:
- dashboard targeted tests:
- npm test:
- dashboard layout smoke:
- production dashboard smoke:
- cross-page smoke if theme.css changed:

Responsive:
- desktop 1440:
- tablet 768:
- mobile 390:
- horizontal overflow:

What explicitly did NOT change:
- backend/API/RBAC/db/schema/storage:
- unrelated pages:
- business formulas:

Risks:
- ...

Decision:
- ...
```

---

## 28. Final Product Standard

The rentCore Dashboard must always stay within this balance:

```text
Premium visual quality + business clarity + operational actionability + production safety
```

Bad extremes are not acceptable:

```text
Beautiful but useless — unacceptable.
Useful but cheap-looking — unacceptable.
Technological but unreadable — unacceptable.
Simple but empty — unacceptable.
```

The target result:

> The Dashboard must look like a premium operational cockpit that helps an equipment rental business manage money, fleet, service, documents, delivery, risks and daily actions. It must sell the product and help run the company at the same time.

---

## 29. Service Load Calculation Standard — блок «Загрузка сервиса»


### 29.1. Назначение документа

Документ описывает, как в rentCore должен работать блок **«Загрузка сервиса»** на Dashboard и в связанных executive-блоках.

Цель блока — не просто показать количество сервисных заявок, а дать руководителю честный ответ:

> Сколько работы сейчас висит на сервисе, хватает ли механиков/часов, где есть риск просрочки и что нужно сделать.

Этот документ можно использовать как отдельное техническое ТЗ для Codex, разработчиков и будущих ИИ-агентов.

---

### 29.2. Главный принцип

**Загрузка сервиса не должна считаться по количеству заявок.**

Количество заявок само по себе обманывает:

- 10 мелких диагностик не равны 10 тяжёлым ремонтам;
- 1 критическая поломка на объекте может быть важнее 5 обычных заявок;
- заявка в ожидании запчастей не грузит механика прямо сейчас, но создаёт риск простоя техники;
- неназначенная заявка может быть опаснее назначенной, даже если трудоёмкость небольшая.

Правильный смысл метрики:

```text
Загрузка сервиса = объём активной сервисной работы / доступная мощность сервиса
```

Иными словами:

```text
Сервис загружен на 95%, потому что есть 17 часов активной работы при доступной мощности 18 часов.
```

---

### 29.3. Что должен показывать блок

На Dashboard блок **«Загрузка сервиса»** должен показывать:

1. процент загрузки;
2. статус нагрузки;
3. активные заявки;
4. просроченные заявки;
5. критические заявки;
6. заявки без механика;
7. заявки в ожидании запчастей;
8. расчётные часы работ;
9. доступную мощность механиков;
10. понятное действие для руководителя.

Пример карточки:

```text
Загрузка сервиса
95%
Высокая нагрузка
17 ч / 18 ч
Критично: 2 · Ожидают запчасти: 1
```

---

### 29.4. Какие данные нужны

Для корректного расчёта нужны данные из нескольких контуров.

#### 29.4.1. Сервисные заявки

Из раздела **Сервис**:

- id заявки;
- техника;
- клиент / аренда при наличии;
- статус;
- приоритет;
- сценарий работ;
- тип работ;
- дата создания;
- дедлайн;
- назначенный механик;
- список работ;
- список запчастей;
- признак выезда;
- итог ремонта;
- дата закрытия.

#### 29.4.2. Механики

Из справочника механиков / пользователей:

- активен или нет;
- роль: выездной, стационарный, гарантийный, старший механик;
- рабочий график;
- доступен сегодня или нет;
- количество продуктивных часов в день;
- текущие назначенные заявки.

#### 29.4.3. Нормативы работ

Из справочника работ:

- название работы;
- норматив часов;
- тип техники;
- сложность;
- выездная / стационарная работа;
- возможный коэффициент сложности.

Пример нормативов:

| Работа | Норматив |
|---|---:|
| Диагностика | 1.5 ч |
| Плановое ТО | 3 ч |
| ПТО / ЧТО | 4 ч |
| Ремонт электрики | 5 ч |
| Ремонт гидравлики | 6 ч |
| Срочная поломка | 8 ч |
| PDI | 4 ч |
| Выезд на объект | +2 ч |

#### 29.4.4. SLA / сроки

Нужно понимать:

- заявка в срок;
- дедлайн сегодня;
- просрочка 1–2 дня;
- просрочка 3–5 дней;
- просрочка 6+ дней.

---

### 29.5. Какие заявки входят в расчёт загрузки

#### 29.5.1. Включать в рабочую нагрузку

В расчёт активной нагрузки входят заявки со статусами:

```text
Новая
Назначена
В диагностике
В работе
Выезд назначен
Ждёт закрытия
Просрочена
```

#### 29.5.2. Не включать в рабочую нагрузку

Не входят:

```text
Закрыта
Отменена
Архив
```

#### 29.5.3. Особый статус: «Ожидает запчасти»

Заявки в ожидании запчастей нужно учитывать отдельно:

- в рабочую нагрузку механиков полностью не включать;
- в риск сервиса включать обязательно;
- в блоке Dashboard показывать отдельным числом.

Причина: механик прямо сейчас может не выполнять работу, но техника простаивает, клиент ждёт, аренда может терять деньги.

---

### 29.6. Доступная мощность сервиса

#### 29.6.1. Базовая формула

```text
Доступная мощность сервиса = активные механики × продуктивные часы в день
```

Пример:

```text
3 механика × 6 часов = 18 часов/день
```

#### 29.6.2. Почему не 8 часов

Рабочий день может быть 8 часов, но продуктивная мощность ниже из-за:

- дороги;
- ожидания клиента;
- склада;
- поиска запчастей;
- фото и отчётов;
- согласований;
- внутренних простоев;
- переключений между задачами.

Базовое значение по умолчанию:

```text
1 механик = 6 продуктивных часов в день
```

Это значение должно быть настраиваемым в будущем.

---

### 29.7. Расчёт трудоёмкости заявки

#### 29.7.1. Если есть работы с нормативами

```text
Трудоёмкость заявки = сумма нормативов работ + время выезда
```

Пример:

```text
Диагностика 1.5 ч + Ремонт гидравлики 6 ч + Выезд 2 ч = 9.5 ч
```

#### 29.7.2. Если нормативов нет

Использовать fallback по типу / сценарию заявки.

| Тип заявки | Дефолтная трудоёмкость |
|---|---:|
| Диагностика | 1.5 ч |
| Плановое ТО | 3 ч |
| ПТО / ЧТО | 4 ч |
| Ремонт | 6 ч |
| Срочная поломка | 8 ч |
| Рекламация | 5 ч |
| PDI | 4 ч |
| Выезд | +2 ч |

Если используется fallback, интерфейс должен показывать:

```text
Расчёт приближённый: нет нормативов работ, используются дефолтные часы.
```

---

### 29.8. Коэффициенты приоритета

Приоритет должен усиливать влияние заявки на загрузку.

```text
Скорректированные часы = часы × коэффициент приоритета
```

| Приоритет | Коэффициент |
|---|---:|
| Низкий | 0.8 |
| Средний | 1.0 |
| Высокий | 1.3 |
| Критический | 1.6 |

Пример:

```text
Ремонт 6 ч × высокий приоритет 1.3 = 7.8 условных часов нагрузки
```

---

### 29.9. Коэффициенты просрочки

Просрочка должна усиливать давление на показатель.

| Состояние | Коэффициент |
|---|---:|
| В срок | 1.0 |
| Сегодня дедлайн | 1.15 |
| Просрочка 1–2 дня | 1.3 |
| Просрочка 3–5 дней | 1.5 |
| Просрочка 6+ дней | 1.8 |

Формула:

```text
Итоговые условные часы = базовые часы × коэффициент приоритета × коэффициент просрочки
```

---

### 29.10. Итоговая формула загрузки

```text
Загрузка сервиса = сумма условных часов активных заявок / доступная мощность сервиса × 100%
```

Пример:

```text
Активные заявки:
1. ТО — 3 ч × 1.3 × 1.5 = 5.85
2. Диагностика — 1.5 ч × 1.0 × 1.0 = 1.5
3. Ремонт — 6 ч × 1.6 × 1.3 = 12.48

Итого нагрузка = 19.83 ч

Мощность сервиса:
3 механика × 6 ч = 18 ч

Загрузка = 19.83 / 18 × 100 = 110%
```

Отображение:

```text
Загрузка сервиса
110%
Перегруз
19.8 ч / 18 ч
3 критические заявки
```

---

### 29.11. Статусы загрузки

| Загрузка | Статус | Смысл |
|---:|---|---|
| 0–30% | Низкая | сервис почти свободен |
| 31–70% | Нормальная | рабочая загрузка |
| 71–90% | Высокая | нужно контролировать сроки |
| 91–110% | Перегруз | высокий риск просрочек |
| 110%+ | Критично | сервис не успевает |

---

### 29.12. Empty states

Empty state должен объяснять не только “нет данных”, а причину и действие.

#### 29.12.1. Нет сервисных заявок и нет механиков

```text
Загрузка сервиса
Нет данных

Нет сервисных заявок и не настроена мощность сервиса.
Добавьте механиков и создайте заявку при первом ремонте или ТО.
```

#### 29.12.2. Есть механики, но нет заявок

```text
Загрузка сервиса
0%

Активных заявок нет.
Мощность сервиса свободна.
```

#### 29.12.3. Есть заявки, но нет механиков

```text
Загрузка сервиса
Нет мощности

Есть активные заявки, но не настроены активные механики.
Добавьте механиков в справочник или назначьте ответственных.
```

#### 29.12.4. Есть заявки, но нет нормативов

```text
Загрузка сервиса
Расчёт приближённый

Нет нормативов работ. Используются дефолтные часы по типу заявки.
```

#### 29.12.5. Есть заявки в ожидании запчастей

```text
Загрузка сервиса
Рабочая нагрузка: 62%
Риск сервиса: высокий

2 заявки ожидают запчасти и не входят полностью в рабочие часы механиков, но влияют на простой техники.
```

---

### 29.13. Визуал KPI-карточки на Dashboard

Карточка должна быть короткой и управленческой.

#### 29.13.1. Нормальная загрузка

```text
Загрузка сервиса
64%
Нормальная
11.5 ч / 18 ч
Активных: 5 · Просрочено: 0
```

#### 29.13.2. Перегруз

```text
Загрузка сервиса
108%
Перегруз
19.4 ч / 18 ч
Просрочено: 2 · Критично: 1
```

#### 29.13.3. Нет заявок

```text
Загрузка сервиса
0%
Свободна
Активных заявок нет
```

#### 29.13.4. Нет данных

```text
Загрузка сервиса
Нет данных
Нет заявок service или не настроены механики
```

---

### 29.14. Отдельная метрика «Риск сервиса»

Загрузка и риск — разные метрики.

Бывает:

```text
Загрузка: 40%
Риск: высокий
```

Это значит, что сервис не перегружен, но управляется плохо: есть просрочки, неназначенные заявки или ожидание запчастей.

#### 29.14.1. Формула риска

```text
Риск сервиса =
просроченные заявки × 20
+ критические заявки × 15
+ неназначенные заявки × 10
+ ожидание запчастей × 8
+ повторные ремонты × 15
```

Ограничение:

```text
serviceRisk = min(100, сумма баллов)
```

#### 29.14.2. Шкала риска

| Баллы | Статус |
|---:|---|
| 0–20 | OK |
| 21–50 | Внимание |
| 51–80 | Высокий риск |
| 81–100 | Критично |

---

### 29.15. Как блок влияет на «Здоровье компании»

В блоке **«Здоровье компании»** направление **«Сервис»** должно показывать:

- статус сервиса;
- загрузку;
- риск;
- активные заявки;
- просрочки;
- ожидание запчастей;
- действие.

#### 29.15.1. Пример при перегрузе

```text
Сервис
Перегруз

Нагрузка: 95%
Активных заявок: 7
Просрочено: 2
Ожидают запчасти: 1

Действие:
Назначьте механика или перенесите несрочные работы.
```

#### 29.15.2. Пример при отсутствии данных

```text
Сервис
Нет данных

Нет сервисных заявок.
Контур сервиса пока не участвует в расчёте здоровья компании.

Действие:
Создайте заявку при первом ремонте или ТО.
```

---

### 29.16. Тип результата расчёта

Рекомендуемый технический контракт:

```ts
type ServiceLoadStatus =
  | 'no_data'
  | 'free'
  | 'normal'
  | 'high'
  | 'overloaded'
  | 'critical';

type ServiceRiskStatus =
  | 'ok'
  | 'attention'
  | 'high_risk'
  | 'critical';

type ServiceLoadCalculationMode =
  | 'exact_norms'
  | 'fallback_defaults'
  | 'insufficient_data';

type ServiceLoadResult = {
  status: ServiceLoadStatus;
  loadPercent: number | null;
  riskStatus: ServiceRiskStatus;
  riskScore: number;

  activeRequests: number;
  overdueRequests: number;
  criticalRequests: number;
  waitingPartsRequests: number;
  unassignedRequests: number;
  repeatRepairRequests: number;

  estimatedHours: number;
  availableHours: number;
  activeMechanics: number;
  productiveHoursPerMechanic: number;

  calculationMode: ServiceLoadCalculationMode;
  message: string;
  action: string;
};
```

---

### 29.17. Пример результата

```ts
const serviceLoad: ServiceLoadResult = {
  status: 'overloaded',
  loadPercent: 95,
  riskStatus: 'high_risk',
  riskScore: 64,

  activeRequests: 8,
  overdueRequests: 2,
  criticalRequests: 1,
  waitingPartsRequests: 1,
  unassignedRequests: 0,
  repeatRepairRequests: 0,

  estimatedHours: 17.1,
  availableHours: 18,
  activeMechanics: 3,
  productiveHoursPerMechanic: 6,

  calculationMode: 'fallback_defaults',
  message: 'Высокая нагрузка сервиса: 17.1 ч из 18 ч доступной мощности.',
  action: 'Проверьте просроченные заявки и распределение механиков.',
};
```

---

### 29.18. Рекомендации по реализации

#### 29.18.1. Где считать

Предпочтительно считать в отдельной функции/модуле, а не прямо в JSX Dashboard.

Возможный файл:

```text
src/app/pages/dashboard/serviceLoad.ts
```

или:

```text
src/app/lib/dashboard/serviceLoad.ts
```

#### 29.18.2. Почему отдельно

Так проще:

- тестировать формулы;
- менять коэффициенты;
- переиспользовать в Dashboard и Reports;
- показывать ту же логику в «Здоровье компании»;
- не раздувать Dashboard.tsx.

#### 29.18.3. Что покрыть тестами

Тестовые сценарии:

1. нет заявок и нет механиков;
2. есть механики, но нет заявок;
3. есть заявки, но нет механиков;
4. есть заявки с нормативами;
5. есть заявки без нормативов — fallback;
6. есть просроченные заявки;
7. есть критические заявки;
8. есть ожидание запчастей;
9. есть неназначенные заявки;
10. загрузка больше 100%;
11. риск высокий при небольшой загрузке.

---

### 29.19. Acceptance Criteria

Блок **«Загрузка сервиса»** считается корректным, если:

1. считает нагрузку через часы и мощность механиков;
2. не использует просто количество заявок как процент загрузки;
3. учитывает приоритет;
4. учитывает просрочку;
5. отдельно показывает ожидание запчастей;
6. отдельно показывает риск сервиса;
7. объясняет отсутствие данных;
8. показывает действие для руководителя;
9. корректно работает при пустых данных;
10. не ломает Dashboard и «Здоровье компании»;
11. имеет unit-тесты на ключевые сценарии;
12. визуально остаётся частью premium Dashboard rentCore.

---

### 29.20. Ключевой стандарт

```text
Загрузка сервиса = не количество заявок, а управленческая оценка работы сервиса относительно мощности механиков.
```

Dashboard должен показывать не декоративный процент, а объяснимую метрику:

```text
Сервис загружен на 95%.
Причина: 17 ч работ при мощности 18 ч.
Риск: 2 просрочки, 1 ожидание запчастей.
Действие: назначить механика, перенести несрочные работы или ускорить запчасти.
```

---

## 30. Delivery Load Calculation Standard — блок «Доставка сегодня»


### 30.1. Назначение документа

Документ фиксирует логику расчёта и отображения блока **«Доставка сегодня»** на Dashboard rentCore.

Блок должен показывать не просто количество доставок, а состояние дневного логистического контура: сколько заявок запланировано на день, сколько уже закрыто перевозчиками, что в работе, что просрочено и где нужен контроль менеджера.

---

### 30.2. Главная идея метрики

Базовая логика корректная:

```text
Доставки сегодня = сколько доставок запланировано на сегодня / сколько уже выполнено сегодня
```

Например:

```text
Доставки сегодня
4/5
Закрыто 4 из 5 заявок
1 ещё в работе
```

Это хороший управленческий показатель, потому что руководитель сразу видит:

- есть ли логистическая нагрузка сегодня;
- сколько перевозчик уже закрыл;
- сколько осталось;
- есть ли риск по срокам;
- нужно ли вмешательство менеджера.

Но одного `4/5` недостаточно. Нужно считать и показывать детализацию по статусам.

---

### 30.3. Что именно считать

#### 30.3.1. Planned today

Количество доставок, у которых дата перевозки / дата выполнения / дедлайн попадает на текущий день.

```text
plannedToday = все доставки с датой сегодня, кроме отменённых
```

Включать:

- новая;
- отправлена;
- принята;
- в пути;
- выполнена;
- просрочена, если должна была быть сегодня или раньше;
- ожидает подтверждения, если такой статус появится.

Не включать:

- отменена;
- архив;
- черновик без назначенной даты.

---

#### 30.3.2. Completed today

Количество доставок, которые перевозчик или менеджер перевёл в статус **«выполнена»** сегодня.

```text
completedToday = доставки со статусом выполнена и completedAt = сегодня
```

Если `completedAt` пока нет, временно можно использовать `updatedAt`, но лучше добавить/использовать отдельное поле `completedAt`, чтобы не путать выполнение с редактированием.

---

#### 30.3.3. In progress today

Доставки, которые уже приняты или находятся в пути.

```text
inProgressToday = статусы: принята, в пути, отправлена
```

---

#### 30.3.4. Not started today

Доставки на сегодня, которые ещё не приняты перевозчиком.

```text
notStartedToday = plannedToday - completedToday - inProgressToday
```

Обычно это статусы:

- новая;
- назначена;
- ожидает перевозчика.

---

#### 30.3.5. Overdue deliveries

Доставки, у которых дедлайн прошёл, а статус не выполнен.

```text
overdueDeliveries = deadline < now && status != выполнена && status != отменена
```

Отдельно важно считать:

- просрочено сегодня;
- просрочено со вчера/раньше.

---

### 30.4. Основная формула KPI

Главная карточка Dashboard должна показывать:

```text
Доставки сегодня
completedToday / plannedToday
```

Пример:

```text
Доставки сегодня
4/5
Закрыто 4 · в пути 1 · просрочено 0
```

Если доставок нет:

```text
Доставки сегодня
0/0
На сегодня доставок нет
```

Лучше не показывать `0/0` как крупное значение, а заменить на человекочитаемый статус:

```text
Доставки сегодня
Нет задач
На сегодня доставок не запланировано
```

---

### 30.5. Процент выполнения

Дополнительно можно считать процент выполнения дневного плана:

```text
deliveryCompletionPercent = completedToday / plannedToday * 100
```

Если `plannedToday = 0`, процент не рассчитывается.

Примеры:

```text
4 / 5 = 80%
2 / 3 = 67%
5 / 5 = 100%
```

---

### 30.6. Статусы блока

| Состояние | Условие | Статус на Dashboard |
|---|---|---|
| Нет задач | plannedToday = 0 | `Нет доставок сегодня` |
| Всё закрыто | completedToday = plannedToday | `Закрыто` |
| В работе | есть inProgressToday, просрочек нет | `В работе` |
| Есть незапущенные | notStartedToday > 0 | `Нужен контроль` |
| Есть просрочки | overdueDeliveries > 0 | `Риск` |
| Нет данных | нет коллекции доставок или данные не загружены | `Нет данных` |

---

### 30.7. Цветовая логика

| Статус | Цвет |
|---|---|
| Закрыто / всё выполнено | Lime / green |
| В работе | Teal / cyan |
| Нужен контроль | Amber |
| Риск / просрочка | Coral / red |
| Нет данных | Gray / muted |

Цвет не должен быть единственным носителем смысла. Рядом всегда должен быть текстовый статус.

---

### 30.8. Что показывать в KPI-карточке

#### Хороший вариант

```text
Доставки сегодня
4/5
Закрыто 4 · в пути 1 · просрочено 0
```

#### Если есть риск

```text
Доставки сегодня
2/5
2 в пути · 1 не принята · 1 просрочена
```

#### Если доставок нет

```text
Доставки сегодня
Нет задач
На сегодня доставок не запланировано
```

#### Если нет данных

```text
Доставки сегодня
Нет данных
Нет записей доставок. Создайте доставку при отгрузке техники.
```

---

### 30.9. Что показывать в блоке «Задачи сегодня»

В строке задач:

```text
Доставки сегодня
Закрыто 4 из 5 · в пути 1
4/5
```

Если проблема:

```text
Доставки сегодня
1 просрочена · 1 не принята перевозчиком
2/5
```

Если пусто:

```text
Доставки сегодня
На сегодня доставок нет
0
```

---

### 30.10. Что показывать в блоке «Здоровье компании» → «Доставка»

#### Если всё хорошо

```text
Доставка
OK
Сегодня закрыто 4 из 5 доставок. Просрочек нет.
Действие: контроль не требуется.
```

#### Если есть риск

```text
Доставка
Риск
1 доставка просрочена, 1 не принята перевозчиком.
Действие: свяжитесь с перевозчиком и проверьте маршрут.
```

#### Если нет данных

```text
Доставка
Нет данных
Нет записей доставок, поэтому логистический контур пока не считается.
Действие: создайте доставку при отгрузке техники.
```

---

### 30.11. Риск доставки

Помимо выполнения дневного плана, нужно считать риск логистики.

#### Формула риска

```text
deliveryRiskScore =
  overdueDeliveries * 25
+ notAcceptedDeliveries * 15
+ inProgressAfterDeadline * 20
+ noCarrierAssigned * 20
+ missingAddressOrContact * 10
```

И ограничивать 100:

```text
deliveryRiskScore = min(100, deliveryRiskScore)
```

#### Шкала риска

| Баллы | Статус |
|---:|---|
| 0–20 | OK |
| 21–50 | Внимание |
| 51–80 | Высокий риск |
| 81–100 | Критично |

---

### 30.12. Какие поля нужны в данных доставки

Минимально нужны:

```ts
type Delivery = {
  id: string;
  rentalId?: string;
  type: 'delivery' | 'pickup'; // отгрузка или приёмка
  status: 'new' | 'sent' | 'accepted' | 'in_transit' | 'completed' | 'cancelled';
  scheduledDate: string;
  deadlineAt?: string;
  completedAt?: string;
  carrierId?: string;
  carrierName?: string;
  clientId?: string;
  clientName?: string;
  equipmentIds?: string[];
  fromAddress?: string;
  toAddress?: string;
  contactName?: string;
  contactPhone?: string;
  managerId?: string;
  cost?: number;
  createdAt: string;
  updatedAt: string;
};
```

Если `completedAt` отсутствует, его нужно добавить в будущем. Это важное поле для корректного расчёта `completedToday`.

---

### 30.13. Технический результат расчёта

Рекомендуемый тип результата:

```ts
type DeliveryLoadResult = {
  status: 'no_data' | 'empty' | 'completed' | 'in_progress' | 'needs_control' | 'risk';
  plannedToday: number;
  completedToday: number;
  inProgressToday: number;
  notStartedToday: number;
  overdueToday: number;
  overdueTotal: number;
  completionPercent: number | null;
  riskScore: number;
  hasData: boolean;
  message: string;
  action: string;
};
```

Пример:

```ts
{
  status: 'in_progress',
  plannedToday: 5,
  completedToday: 4,
  inProgressToday: 1,
  notStartedToday: 0,
  overdueToday: 0,
  overdueTotal: 0,
  completionPercent: 80,
  riskScore: 10,
  hasData: true,
  message: 'Закрыто 4 из 5 доставок. 1 доставка ещё в пути.',
  action: 'Проверьте статус оставшейся доставки до конца дня.'
}
```

---

### 30.14. Empty states

#### Нет записей доставок вообще

```text
Доставка
Нет данных
В системе нет записей доставок. Логистический контур пока не участвует в расчёте Dashboard.
Действие: создайте доставку при отгрузке или приёмке техники.
```

#### Есть доставки, но сегодня нет задач

```text
Доставки сегодня
Нет задач
На сегодня доставок не запланировано.
```

#### Есть доставка без перевозчика

```text
Доставки сегодня
Нужен контроль
Есть доставка без назначенного перевозчика.
Действие: назначьте перевозчика.
```

#### Есть доставка без адреса или контакта

```text
Доставки сегодня
Нужен контроль
У доставки не заполнен адрес или контактное лицо.
Действие: проверьте маршрут и контакт клиента.
```

---

### 30.15. Управленческий смысл

Блок «Доставка сегодня» должен помогать руководителю быстро понять:

1. сколько логистических задач было на сегодня;
2. сколько уже закрыто;
3. сколько в пути;
4. сколько не начато;
5. есть ли просрочка;
6. есть ли проблемы с перевозчиком, адресом или контактом;
7. нужно ли вмешательство менеджера.

---

### 30.16. Главный стандарт

Блок доставки нельзя считать только как количество записей.

Правильная логика:

```text
Доставка сегодня = дневной план + факт закрытия + статус выполнения + риск логистики
```

Целевое отображение:

```text
Доставки сегодня
4/5
Закрыто 4 · в пути 1 · просрочено 0
```

И в случае риска:

```text
Доставки сегодня
2/5
1 просрочена · 1 не принята перевозчиком
Действие: свяжитесь с перевозчиком
```
