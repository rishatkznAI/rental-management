#!/bin/bash
cd "$(dirname "$0")"
echo "=== Пушим исправление регистра импортов ==="
git add -A
git commit -m "Fix: lowercase component imports for Linux CI (case-sensitive)"
git push origin main
echo ""
echo "=== Деплой запущен! ==="
open "https://github.com/rishatkznAI/rental-management/actions"
read -p "Нажмите Enter для закрытия..."
