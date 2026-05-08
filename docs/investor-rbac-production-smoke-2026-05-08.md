# Investor RBAC Production Smoke

Date: 2026-05-08

Status: `PASSED WITH DATA LIMITATION / PARTIAL`

This was a read-only production smoke check after deploying investor RBAC fixes. No production data, roles, passwords, tokens, or settings were changed.

## Deployment

- Production commit: `939605253a648ae875336594141bd6149df3cd72`
- Short commit: `939605253a64`
- Deploy startedAt: `2026-05-08T19:11:38.536Z`

## Investor Session

- User: `smoke-office@yandex.ru`
- Role: `Инвестор`
- ownerId: `own-1778265463628`
- ownerName: `Рамиль`

## Confirmed

- `/api/version` shows the expected production commit.
- `/api/auth/me` returns role `Инвестор` and the expected `ownerId`.
- `readableCollections` contains only `equipment`, `gantt_rentals`, `owners`, `rentals`.
- Left menu shows only `Техника`, `Аренды`, `Личные настройки`.
- Foreign `equipment`, `rentals`, and `gantt_rentals` detail endpoints return `403`.
- `/api/rental_change_requests` returns `403`.
- Forbidden APIs are closed, including clients, payments, documents, service, users, app settings, finance, admin diagnostics, and staff manager options.
- Direct route to a foreign rental does not disclose data and shows `Аренда не найдена`.
- Direct route `#/payments` redirects to `#/equipment`.
- Browser console errors: `0`.
- Page errors: `0`.
- HTTP `500` responses: `0`.
- No infinite redirect loop observed.

## Remaining Limitation

The production investor owner `own-1778265463628` currently has no equipment and no rentals. Because of that, the positive scoped-read scenario "investor sees own records" could not be verified against real production owned rows.

Positive scoped-read can be verified only when this `ownerId` has real owned equipment/rental rows in production, or through local/e2e bootstrap data.
