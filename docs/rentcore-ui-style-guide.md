# rentCore Industrial Dark UI

## Purpose

rentCore Industrial Dark UI is the visual standard for the rental management product. The interface should feel like a premium industrial B2B SaaS for fleet rental, service, logistics, finance, documents, telemetry, and bot workflows.

The dark theme is the primary presentation theme. The light theme may remain available, but new UI work must be designed against the dark graphite system first and then checked for light readability.

## Palette

- App background: deep graphite, not flat black. Use `--background` and the global body texture.
- Surface: `--card` for cards, tables, sheets, and content panels.
- Surface elevated: `--rc-surface-elevated` for modals, popovers, drawers, and active overlays.
- Border: `--border` / `--rc-border`; keep borders thin and translucent.
- Text primary: `--foreground`; use for titles, metrics, and table body values.
- Text secondary: `--rc-text-secondary`; use for supporting metadata.
- Text muted: `--muted-foreground`; use for labels, hints, empty states.
- Accent: `--primary`, the rentCore green. Use for active navigation, primary actions, focus, selected states, and sparingly for KPI emphasis.
- Accent soft: `--accent` or `--rc-accent-soft`; use for hover, selected row backgrounds, and subtle active panels.
- Status colors: use `--success`, `--warning`, `--danger`, and `--info` through shared badge/status classes.

## Sidebar

- Sidebar is a dark graphite surface with a subtle vertical industrial gradient.
- Active item uses the rentCore green accent with `text-primary-foreground`.
- Hover items use a translucent accent fill, never bright blue.
- Search stays compact and dark, with a green focus ring.
- Collapsed state must keep icons legible and preserve badges.

## Topbar

- Topbar uses `--rc-topbar` with blur and a thin bottom border.
- Icon buttons use card surfaces, green hover/focus, and 10-12px radius.
- User area uses a compact elevated chip. Avatar gradients may use green/cyan, not blue/purple as the main brand signal.

## Page Header

- Prefer `app-page-shell` for page spacing and `app-page-header` for major page headers.
- Use `app-page-title` for page titles and `app-page-subtitle` for descriptions.
- Keep page headers functional: title, short context, and actions. Avoid landing-page hero layouts inside product screens.

## KPI Cards

- Prefer `app-kpi-card` for local KPI helpers and shared `Card` for richer metrics.
- KPI cards should be compact, stable in height, and readable on mobile.
- Use green for positive/primary emphasis, amber for warning, red for risk, cyan/blue only for informational states.
- Avoid oversized decorative KPIs and avoid one-off card shadows.

## Cards

- Use shared `Card` or `app-panel`.
- Large panels: 20-24px radius.
- Small controls and chips: 10-14px radius.
- Do not nest decorative cards inside decorative cards. Use inner rows, lists, or bordered blocks when detail is needed.

## Tables

- Use shared table primitives when possible.
- Tables should be compact, with muted uppercase headers, thin borders, and soft accent hover.
- Selected rows use a soft green accent, not saturated blue.
- Avoid white table containers in dark theme.

## Filters And Search

- Prefer `app-filter-bar` for page-level filters.
- Inputs, selects, and textareas must use shared primitives or the same token values.
- Focus states use `--ring` and green accent borders.
- Filter chips use `app-filter-chip` and `data-active="true"` for selected state.

## Buttons

- Primary actions use the shared `Button` default variant.
- Secondary and outline actions must stay quiet and token-based.
- Destructive actions use the destructive variant or `--danger` tokens.
- Icon-only buttons need accessible labels or titles.

## Statuses And Badges

- Use `Badge` or `app-status-pill`.
- Variants:
  - `app-status-success`
  - `app-status-warning`
  - `app-status-danger`
  - `app-status-info`
  - `app-status-default`
- Do not create new hardcoded status palettes inside pages unless the status semantics are genuinely new.

## Modals And Sheets

- Use shared `Dialog` and `Sheet`.
- Modal and drawer surfaces are elevated graphite with translucent borders.
- Footer areas must stay sticky when the modal has a scrollable body.
- Close buttons use muted text and green hover/focus.

## Mobile

- Preserve the fixed mobile topbar and bottom navigation.
- KPI grids collapse into readable one or two column layouts.
- Tables need mobile card alternatives or horizontal scroll with stable dimensions.
- Buttons and filters must wrap without text overlap.

## Light Theme

- Light theme remains supported, but it is secondary.
- Do not remove light variables.
- Any new token should have a usable light value, even if the visual priority is dark.
- Avoid dark-only hardcoded text that becomes unreadable in light mode.

## Hardcoded Color Rule

Do not add new page-level hardcoded colors such as `bg-white`, `text-slate-*`, `border-gray-*`, `blue-*`, `#...`, or raw `rgba(...)` for core surfaces, text, controls, tables, modals, and statuses.

Use shared primitives, CSS variables, `app-panel`, `app-kpi-card`, `app-filter-bar`, `app-status-*`, and existing UI components. Hardcoded colors are acceptable only for data visualization series or specific brand/media assets.

## New Screens

Every new tab, dialog, drawer, KPI, table, filter, and status must use this standard. If a page needs a new visual pattern, add it to the shared UI layer first and document it here.
