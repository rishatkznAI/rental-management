#!/bin/bash
cd "$(dirname "$0")"
echo "=== Обновляем package-lock.json ==="

# Обновляем lock-файл не трогая node_modules
npm install --package-lock-only

echo ""
echo "=== Пушим в GitHub ==="
git add package.json package-lock.json
git commit -m "Fix: add react/react-dom to dependencies, update lockfile"
git push origin main

echo ""
echo "=== Готово! Деплой запущен ==="
open "https://github.com/rishatkznAI/rental-management/actions"
read -p "Нажмите Enter для закрытия..."
