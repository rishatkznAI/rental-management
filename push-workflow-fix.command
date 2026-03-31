#!/bin/bash
cd "$(dirname "$0")"
echo "=== Пушим исправление workflow ==="
git add .github/workflows/deploy.yml
git commit -m "Fix: use npm install --legacy-peer-deps in CI"
git push origin main
echo ""
echo "=== Готово! ==="
open "https://github.com/rishatkznAI/rental-management/actions"
read -p "Нажмите Enter для закрытия..."
