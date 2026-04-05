#!/bin/bash
# commit-source.command — коммит исходного кода в main
cd "$(dirname "$0")"

# Снимаем блокировку если есть
rm -f .git/index.lock .git/HEAD.lock

echo ""
echo "📦 Добавляем изменения..."
git add src/ index.html

echo ""
echo "💾 Создаём коммит..."
git commit -m "feat(mobile): full mobile adaptation + fix detail pages

Mobile adaptation:
- Layout.tsx: mobile top bar with hamburger, slide-in sidebar overlay,
  fixed bottom navigation (5 tabs: Dashboard / Equipment / Rentals /
  Service / Clients). Main content padded for top/bottom bars on mobile.
- Sidebar.tsx: accepts isOpen/onClose props, slide-in on mobile
  (translate-x), auto-close on navigation, X button on mobile.
- Dashboard: responsive KPI grid (2 cols mobile → 5 cols desktop),
  button labels truncated on mobile, spacing reduced.
- Equipment / Clients / Service: mobile card list view replaces table
  on small screens. Desktop table hidden with sm:hidden / hidden sm:block.
- All pages: p-8 → p-4 sm:p-6 md:p-8, text-3xl → text-2xl sm:text-3xl,
  page headers wrap flex-col on mobile with sm:flex-row.
- Rentals Gantt: height calc accounts for mobile top/bottom bars.
- RentalDetail, EquipmentDetail: action button rows wrap on mobile.

Fix detail pages (Service + Clients modules):
- ServiceDetail.tsx: was searching empty mockServiceRequests[] — fixed
  to use loadServiceTickets(). Full card with status actions, history.
- ClientDetail.tsx: was searching empty mockClients[] — fixed to use
  loadClients(). Full card with inline edit mode, rental history.
- ServiceNew.tsx, ClientNew.tsx: expanded forms, redirect to new record.
- types.ts: extended ServiceTicket and Client with optional fields."

echo ""
echo "🚀 Пушим в main..."
git push origin main

echo ""
echo "✅ Готово! Исходный код обновлён на GitHub."
echo ""
read -p "Нажмите Enter для выхода..."
