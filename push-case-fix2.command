#!/bin/bash
cd "$(dirname "$0")"
git add -A
git commit -m "Fix: lowercase ui imports in components/gantt and components/modals"
git push origin main
open "https://github.com/rishatkznAI/rental-management/actions"
read -p "Нажмите Enter для закрытия..."
