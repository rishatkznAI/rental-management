#!/bin/bash
# commit-source.command — коммит исходного кода в main
cd "$(dirname "$0")"

# Снимаем блокировку если есть
rm -f .git/index.lock .git/HEAD.lock

echo ""
echo "📦 Добавляем изменения..."
git add src/ index.html open-fresh.command open-site.command public/clear.html public/reset.html

echo ""
echo "💾 Создаём коммит..."
git commit -m "fix(rental): overhaul Gantt visuals, status logic, toast notifications

- Gantt bars: larger, bolder, show client + status + dates
- Grid lines more visible; empty rows show 'нет аренд'
- Manager filter: dynamic from users DB
- Toast on rental create and return
- ReturnModal: dropdown to select active rental
- index.html: bump cache-bust key"

echo ""
echo "🚀 Пушим в main..."
git push origin main

echo ""
echo "✅ Готово! Исходный код обновлён на GitHub."
echo ""
read -p "Нажмите Enter для выхода..."
