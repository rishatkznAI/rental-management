#!/bin/bash
echo "=== Исправление GitHub Pages ==="
echo ""

GH="/opt/homebrew/bin/gh"

# Делаем репозиторий публичным через API
echo ">>> Делаем репозиторий публичным..."
$GH api \
  --method PATCH \
  /repos/rishatkznAI/rental-management \
  -f private=false
echo "Статус: $?"
echo ""

# Проверяем что стал публичным
echo ">>> Проверяем видимость репозитория..."
$GH api /repos/rishatkznAI/rental-management --jq '.private'
echo "(false = публичный, true = приватный)"
echo ""

# Включаем GitHub Pages
echo ">>> Включаем GitHub Pages..."
$GH api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  /repos/rishatkznAI/rental-management/pages \
  -f build_type=workflow
echo "Статус: $?"
echo ""

# Запускаем деплой через push (создаём пустой коммит)
echo ">>> Запускаем деплой..."
cd ~/Desktop 2>/dev/null || cd ~
REPO_PATH=$(find ~ -name "rental-management" -type d -maxdepth 5 2>/dev/null | grep -v node_modules | head -1)
if [ -n "$REPO_PATH" ]; then
  echo "Найден репозиторий: $REPO_PATH"
  cd "$REPO_PATH"
  git commit --allow-empty -m "Trigger deploy"
  git push origin main
else
  echo "Репозиторий не найден локально, запускаем workflow вручную..."
  $GH workflow run deploy.yml --repo rishatkznAI/rental-management --ref main
fi
echo ""

echo "==================================="
echo "Открываю Actions для отслеживания..."
open "https://github.com/rishatkznAI/rental-management/actions"
echo ""
echo "Сайт будет доступен через 2-3 мин:"
echo "https://rishatkznai.github.io/rental-management/"
echo "==================================="
read -p "Нажмите Enter для закрытия..."
