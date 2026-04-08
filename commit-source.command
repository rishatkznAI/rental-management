#!/bin/bash
# commit-source.command — коммит исходного кода в main
cd "$(dirname "$0")"

# Снимаем блокировку если есть
rm -f .git/index.lock .git/HEAD.lock

echo ""
echo "📦 Добавляем изменения..."
git add src/ index.html server/server.js vite.config.ts

echo ""
echo "💾 Создаём коммит..."
git commit -m "feat(sync): server as source of truth — cross-device sync via REST API

Architecture migration: localStorage bridge → server-backed data layer

server/server.js:
  - Full Express REST API with generic CRUD factory (registerCRUD)
  - 10 collections: equipment, rentals, gantt_rentals, service, clients,
    documents, payments, shipping_photos, owners, users
  - Server-side sessions (Bearer token, 24h TTL, crypto.randomBytes)
  - Auth endpoints: POST /api/auth/login, GET /api/auth/me, POST /api/auth/logout
  - Server-side RBAC: WRITE_PERMISSIONS per collection per role
  - SHA-256 + salt password hashing (same algorithm as client)
  - seedDefaultUsers() on startup

vite.config.ts:
  - Dev proxy: /api → http://localhost:3000

src/app/lib/api.ts (new):
  - Typed fetch wrapper with Bearer auth
  - api.get / post / patch / put / del
  - AUTH_TOKEN_KEY, setToken(), clearToken()

src/app/contexts/AuthContext.tsx:
  - Server-side auth via /api/auth/login + /api/auth/me
  - isLoading guard prevents flash redirect before token validation

src/app/components/auth/PrivateRoute.tsx:
  - Added isLoading guard

src/app/lib/userStorage.ts:
  - saveUsers() now fire-and-forget syncs to server

src/app/mock-data.ts:
  - All saveX() functions fire-and-forget to server (bridge pattern)

src/app/hooks/useSyncData.ts (new):
  - On login: fetches all 10 collections from server → localStorage
  - Enables cross-device sync for pages not yet fully migrated to react-query

src/app/App.tsx:
  - SyncEffect component runs useSyncData inside AuthProvider
  - refetchOnWindowFocus: true for automatic cross-tab refresh

Pages migrated to react-query + service layer:
  - Dashboard.tsx, Equipment.tsx, Payments.tsx, RentalNew.tsx
  - ServiceDetail.tsx, ServiceNew.tsx, ClientDetail.tsx
  - ClientNew.tsx, EquipmentNew.tsx

Services (all migrated to API):
  - equipment.service.ts, clients.service.ts, rentals.service.ts
  - service.service.ts, payments.service.ts, documents.service.ts"

echo ""
echo "🚀 Пушим в main..."
git push origin main

echo ""
echo "✅ Готово! Исходный код обновлён на GitHub."
echo ""
read -p "Нажмите Enter для выхода..."
