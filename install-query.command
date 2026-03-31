#!/bin/bash
# Двойной клик — установит @tanstack/react-query и перезапустит приложение
cd "$(dirname "$0")"
echo "📦 Устанавливаем @tanstack/react-query..."
npm install @tanstack/react-query
echo ""
echo "✅ Готово! Перезапускаем приложение..."
echo ""
pkill -f "vite" 2>/dev/null || true
sleep 1
npm run dev -- --host
