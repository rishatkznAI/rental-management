#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "══════════════════════════════════════════════"
echo "   ⬆️  Публикация изменений на GitHub"
echo "══════════════════════════════════════════════"
echo ""

git add .

echo "Что изменили? (или нажмите Enter для авто-описания):"
read COMMIT_MSG

if [ -z "$COMMIT_MSG" ]; then
  COMMIT_MSG="Update: $(date '+%d.%m.%Y %H:%M')"
fi

git commit -m "$COMMIT_MSG"

echo ""
echo "⬆️  Отправляем на GitHub..."
git push origin main

echo ""
echo "✅ Готово! GitHub Actions задеплоит изменения за ~2 минуты."
echo "   Следите на: https://github.com/rishatkznAI/rental-management/actions"
echo ""
read -p "Нажмите Enter для выхода..."
