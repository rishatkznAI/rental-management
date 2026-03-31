#!/bin/bash
GH="/opt/homebrew/bin/gh"

echo "=== Полный лог последнего запуска ==="
RUN_ID=$($GH run list --repo rishatkznAI/rental-management --limit 1 --json databaseId --jq '.[0].databaseId')
echo "Run ID: $RUN_ID"
echo ""

$GH run view $RUN_ID --repo rishatkznAI/rental-management --log-failed 2>&1 | grep -A5 -B5 "error\|Error\|ERROR\|failed\|Failed" | head -80

echo ""
read -p "Нажмите Enter для закрытия..."
