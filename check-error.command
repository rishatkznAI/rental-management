#!/bin/bash
GH="/opt/homebrew/bin/gh"

echo "=== Лог последнего упавшего воркфлоу ==="
echo ""

# Получаем ID последнего запуска
RUN_ID=$($GH run list --repo rishatkznAI/rental-management --limit 1 --json databaseId --jq '.[0].databaseId')
echo "Run ID: $RUN_ID"
echo ""

# Смотрим детали запуска
echo "--- Детали запуска ---"
$GH run view $RUN_ID --repo rishatkznAI/rental-management
echo ""

# Смотрим логи
echo "--- Логи ---"
$GH run view $RUN_ID --repo rishatkznAI/rental-management --log-failed 2>&1 | tail -50

echo ""
echo "=== Статус Pages ==="
$GH api /repos/rishatkznAI/rental-management/pages 2>&1

read -p "Нажмите Enter для закрытия..."
