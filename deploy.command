#!/bin/bash
# deploy.command — сборка и публикация на GitHub Pages
cd "$(dirname "$0")"

rm -f .git/index.lock .git/HEAD.lock .git/refs/heads/main.lock

# ── Определяем VITE_API_URL ───────────────────────────────────────────────────
API_URL=""

# 1. Приоритет: RAILWAY_URL в server/.env (постоянный, не меняется)
if [ -f "server/.env" ]; then
  API_URL=$(grep -E '^RAILWAY_URL=' server/.env | cut -d'=' -f2- | tr -d '[:space:]')
fi

# 2. Fallback: WEBHOOK_URL (cloudflared туннель, меняется при каждом запуске)
if [ -z "$API_URL" ] && [ -f "server/.env" ]; then
  API_URL=$(grep -E '^WEBHOOK_URL=' server/.env | cut -d'=' -f2- | tr -d '[:space:]')
fi

# 3. Fallback: cloudflared metrics напрямую
if [ -z "$API_URL" ]; then
  API_URL=$(curl -s http://127.0.0.1:20241/metrics 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | head -1)
fi

echo ""
if [ -n "$API_URL" ]; then
  echo "🌐 API URL для production: $API_URL"
  export VITE_API_URL="$API_URL"
else
  echo "⚠️  API URL не найден. Сборка без VITE_API_URL."
  echo "   Добавьте в server/.env строку: RAILWAY_URL=https://ваш-сервис.up.railway.app"
  echo ""
  read -p "Продолжить всё равно? (Enter = да, Ctrl+C = отмена): "
fi

echo ""
echo "🔨 Собираем production-версию..."
npm run build

if [ $? -ne 0 ]; then
  echo "❌ Сборка не удалась."
  read -p "Нажмите Enter для выхода..."
  exit 1
fi

echo ""
echo "🚀 Публикуем на GitHub Pages..."
npx -y gh-pages -d dist

echo ""
echo "✅ Готово! Сайт: https://rishatkznai.github.io/rental-management/"
echo ""
read -p "Нажмите Enter для выхода..."
