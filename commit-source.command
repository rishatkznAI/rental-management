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
git commit -m "fix(equipment): full dark mode for Equipment list page

- Filter bar: bg-white → dark:bg-gray-800, border-gray-200 → dark:border-gray-700
- Table wrapper: bg-white → dark:bg-gray-800, border → dark:border-gray-700
- Page header: text-gray-900 → dark:text-white, text-gray-500 → dark:text-gray-400
- Table cells: added dark:text-gray-300 for content, dark:text-gray-400 for secondary
- Mobile cards: bg-white → dark:bg-gray-800, border and hover adapted for dark
- Mobile card labels: text-gray-700 → dark:text-gray-300, text-gray-500 → dark:text-gray-400
- Dropdown menu (⋮): bg-white → dark:bg-gray-800, items → dark:text-gray-200 dark:hover:bg-gray-700
- MoreVertical button: dark:text-gray-400 dark:hover:bg-gray-700
- Empty state: bg-gray-100 → dark:bg-gray-700, text fixed for dark
- Results counter: text-gray-500 → dark:text-gray-400
- Search icon: dark:text-gray-500
- All 9 spec points addressed: text contrast, table, search, badges, buttons,
  columns, unified dark design, all states"

echo ""
echo "🚀 Пушим в main..."
git push origin main

echo ""
echo "✅ Готово! Исходный код обновлён на GitHub."
echo ""
read -p "Нажмите Enter для выхода..."
