#!/bin/bash
echo "========================================="
echo "   Настройка GitHub Pages"
echo "========================================="
echo ""

GH="/opt/homebrew/bin/gh"

# Проверяем авторизацию
echo "1. Проверяем авторизацию gh..."
$GH auth status
echo ""

# Делаем репозиторий публичным
echo "2. Делаем репозиторий публичным..."
$GH repo edit rishatkznAI/rental-management --visibility public
echo "   Результат: $?"
echo ""

# Включаем GitHub Pages через API
echo "3. Включаем GitHub Pages..."
$GH api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  /repos/rishatkznAI/rental-management/pages \
  -f build_type=workflow \
  -f source='{"branch":"main","path":"/"}' 2>&1 | head -5
echo ""

# Запускаем workflow
echo "4. Запускаем деплой..."
$GH workflow run deploy.yml \
  --repo rishatkznAI/rental-management \
  --ref main
echo "   Результат: $?"
echo ""

echo "========================================="
echo "Готово! Открываю Actions..."
open "https://github.com/rishatkznAI/rental-management/actions"
echo ""
echo "Через 2-3 минуты сайт будет на:"
echo "https://rishatkznai.github.io/rental-management/"
echo "========================================="
echo ""
read -p "Нажмите Enter для закрытия..."
