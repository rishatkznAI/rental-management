#!/usr/bin/env bash
# publish.sh — собирает приложение и публикует в gh-pages ветку
# Запускать: bash publish.sh
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
PUBLISH_DIR="/tmp/rental-publish-$$"
BUILD_TS="$(date +%Y%m%d_%H%M%S)"

echo "▶ Рабочая директория: $REPO_DIR"
cd "$REPO_DIR"

# ── 1. Чистим зависшие worktrees ─────────────────────────────────────────────
echo ""
echo "▶ Очищаем зависшие worktrees..."
rm -rf .git/worktrees/rental-management .git/worktrees/rental-management-gh-pages 2>/dev/null || true
git worktree prune 2>/dev/null || true
echo "   Готово."

# ── 2. Проверяем что main не сломан ─────────────────────────────────────────
echo ""
echo "▶ Текущая ветка: $(git branch --show-current)"
echo "▶ Последний коммит: $(git log --oneline -1)"

# ── 3. Сборка ────────────────────────────────────────────────────────────────
echo ""
echo "▶ Собираем приложение (npm run build)..."
npm run build
echo "   Сборка завершена."

# ── 4. Обновляем BUILD_TS в dist/index.html ──────────────────────────────────
if [ -f dist/index.html ]; then
  # Обновляем BUILD_TS на текущее время чтобы браузеры сбросили кеш
  sed -i.bak "s/var BUILD_TS  = '[^']*'/var BUILD_TS  = '$BUILD_TS'/" dist/index.html && \
    rm -f dist/index.html.bak && \
    echo "   BUILD_TS обновлён: $BUILD_TS"
fi

# ── 5. Создаём временный worktree для gh-pages ───────────────────────────────
echo ""
echo "▶ Создаём временный worktree для gh-pages..."
git worktree add "$PUBLISH_DIR" gh-pages
echo "   Worktree: $PUBLISH_DIR"

# ── 6. Копируем сборку в worktree ────────────────────────────────────────────
echo ""
echo "▶ Копируем dist/ → gh-pages..."
# Сохраняем служебные файлы GitHub Pages
cp "$PUBLISH_DIR/.nojekyll" /tmp/.nojekyll 2>/dev/null || touch /tmp/.nojekyll
cp "$PUBLISH_DIR/404.html"  /tmp/404.html  2>/dev/null || true

# Чистим всё кроме .git
find "$PUBLISH_DIR" -mindepth 1 -maxdepth 1 \
  ! -name '.git' ! -name '.gitignore' \
  -exec rm -rf {} +

# Копируем новый dist
cp -r dist/. "$PUBLISH_DIR/"

# Восстанавливаем служебные файлы (если dist их не создал)
[ -f /tmp/.nojekyll ] && cp /tmp/.nojekyll "$PUBLISH_DIR/.nojekyll"
[ -f /tmp/404.html ]  && cp /tmp/404.html  "$PUBLISH_DIR/404.html"

echo "   Скопировано."

# ── 7. Коммитим ──────────────────────────────────────────────────────────────
echo ""
echo "▶ Коммитим в gh-pages..."
cd "$PUBLISH_DIR"
git add -A
git commit -m "Publish: fix navigation — useEffect auth guard, remove PrivateRoute wrapper

Built: $BUILD_TS
Source: $(cd "$REPO_DIR" && git log --oneline -1)"

echo "   Коммит создан."

# ── 8. Пушим ─────────────────────────────────────────────────────────────────
echo ""
echo "▶ Пушим gh-pages на GitHub..."
git push origin gh-pages
echo "   Успешно запушено!"

# ── 9. Убираем временный worktree ────────────────────────────────────────────
cd "$REPO_DIR"
git worktree remove "$PUBLISH_DIR" --force 2>/dev/null || rm -rf "$PUBLISH_DIR"

echo ""
echo "✅ Готово! Сайт обновится на GitHub Pages через ~30-60 секунд."
echo "   URL: https://rrishatkznai.github.io/rental-management/"
