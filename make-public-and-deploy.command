#!/bin/bash
cd "$(dirname "$0")"

echo "=== Делаем репозиторий публичным ==="
/opt/homebrew/bin/gh repo edit rishatkznAI/rental-management --visibility public --yes

echo ""
echo "=== Запускаем деплой ==="
/opt/homebrew/bin/gh workflow run deploy.yml --repo rishatkznAI/rental-management

echo ""
echo "=== Готово! ==="
echo "Через 2-3 минуты сайт будет доступен по адресу:"
echo "https://rishatkznai.github.io/rental-management/"
echo ""
read -p "Нажмите Enter чтобы закрыть..."
