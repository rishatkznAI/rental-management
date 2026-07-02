# Company Health Design Spec

**Status:** mandatory source of truth for Dashboard block `Здоровье компании`
**Scope:** only the Company Health block on the rentCore Dashboard
**Parent standard:** `docs/dashboard-design-standard.md`

## Purpose

Company Health is an executive module that shows the overall business condition across six operational directions:

- money;
- fleet;
- service;
- documents;
- delivery;
- returns.

The block must feel like one premium operational cockpit module, not a technical matrix, setup banner, or group of disconnected widgets.

## Desktop Composition

At 1440px, Company Health is one integrated card:

```text
┌────────────────────────────────────────────────────────────────────┐
│ Здоровье компании                         [Критично] [42/100]     │
│ Расчёт по доступным операционным данным                            │
│                                                                    │
│ ┌───────────────┐ ┌──────────────────────┐ ┌────────────────────┐ │
│ │ 42/100        │ │                      │ │ Деньги       Нет   │ │
│ │ Критично      │ │   Health visual      │ │ Парк        Риск  │ │
│ │ 2 риска       │ │   radial/trend       │ │ Сервис      Нет   │ │
│ │ 4 нет данных  │ │                      │ │ Документы   Нет   │ │
│ └───────────────┘ └──────────────────────┘ │ Доставка    Нет   │ │
│                                            └────────────────────┘ │
│ Не учтены: Аренды, Платежи, Сервис, Документы, Доставка            │
└────────────────────────────────────────────────────────────────────┘
```

The desktop body grid must use:

```css
grid-template-columns: 220px minmax(280px, 340px) 1fr;
gap: 16px;
```

## Required Zones

### A. Header Row

- Title: `Здоровье компании`.
- Subtitle: `Расчёт по доступным операционным данным`.
- Right side: status badge and score badge.
- Header height target: 44-56px.
- Badges must wrap on narrow screens and never overflow.

### B. Score Summary Panel

- Desktop width: 200-240px.
- Must show score as `42/100` or `—`.
- Must show one of: `Критично`, `Риск`, `Недостаточно данных`, `OK`.
- Must show risk count, for example `1 риск`.
- Must show missing-data count, for example `5 нет данных`.
- Must include a compact progress/scale.
- Must never be empty.

### C. Health Visual Panel

- Desktop width: 280-360px.
- Contains the radial/ring/trend/progress visual.
- The radial must be embedded inside this panel.
- Radial visual max size: 180-220px.
- The radial must not be a separate small card outside the visual panel.
- The panel must not show a huge central `Нет`.
- If data is insufficient, show compact `Недостаточно данных`, not as the dominant visual.

### D. Direction Summary

- Uses the remaining desktop width.
- Desktop layout: 2 columns x 3 rows.
- Directions are exactly:
  - `Деньги`;
  - `Парк техники`;
  - `Сервис`;
  - `Документы`;
  - `Доставка`;
  - `Возвраты`.
- Each direction card must include:
  - icon;
  - name;
  - status badge;
  - one short reason;
  - one or two metrics.
- Long paragraphs are forbidden.

### E. Data Completeness Strip

- Sits at the bottom inside Company Health.
- Must be a compact local row, not a Dashboard setup banner.
- Valid examples:
  - `Есть: Техника · Нет: Аренды, Платежи, Сервис, Документы, Доставка`
  - `Не учтены: Аренды, Платежи, Сервис, Документы, Доставка`

## Size Constraints

- Company Health desktop card height target: 300-380px.
- Header: 44-56px.
- Body grid columns: `220px minmax(280px, 340px) 1fr`.
- Body grid gap: 16px.
- Direction summary: 2 columns on desktop.
- Radial visual max size: 180-220px.
- No zone may look empty.
- The left zone cannot be empty.
- The radial cannot be a separate widget in an empty area.

## Responsive Rules

### Tablet 768

- Header stays on top.
- Score and visual may sit in one row when space allows.
- Directions move below in 2 columns.
- No horizontal overflow.

### Mobile 390

- Order: header, score panel, visual panel, direction cards, data strip.
- Direction cards stack vertically.
- Header badges wrap without overflow.
- No horizontal overflow.

## Forbidden Patterns

- Large empty left area.
- Radial as a separate small card.
- Direction cards as the only semantic center.
- Huge `Нет`.
- Giant `Недостаточно данных`.
- Debug/status matrix.
- Absolute positioning for the main layout.
- Hidden selectors outside bounds.
- Changes to sidebar, KPI row, app shell, backend, routes, database, or unrelated Dashboard blocks.

## Production Compatibility

The implementation must preserve:

- `dashboard-company-health`;
- `dashboard-radial-overview`;
- `dashboard-radial-core`;
- `dashboard-radial-empty`;
- `dashboard-radial-node`.

Geometry requirements:

- `radialNodesInside=true`;
- radial overview is inside the health visual panel;
- radial nodes stay inside overview bounds;
- no horizontal overflow.

## Screenshot Approval Rule

A Company Health PR cannot be marked `PR_READY` without screenshot or smoke evidence for:

- desktop 1440;
- tablet 768;
- mobile 390.

If screenshots cannot be attached, Playwright geometry evidence must be provided and the final report must explicitly state that visual approval is still required.
