#!/bin/bash
cd "$(dirname "$0")"
echo "=== Пушим исправление ==="

git add package.json
git commit -m "Fix: move react/react-dom to dependencies for CI build"
git push origin main

echo ""
echo "=== Готово! Деплой запущен автоматически ==="
echo "Следи за прогрессом:"
echo "https://github.com/rishatkznAI/rental-management/actions"
echo ""
open "https://github.com/rishatkznAI/rental-management/actions"
read -p "Нажмите Enter для закрытия..."
