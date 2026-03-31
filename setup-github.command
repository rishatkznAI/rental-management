#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "══════════════════════════════════════════════"
echo "   🚀 Публикация проекта на GitHub"
echo "══════════════════════════════════════════════"
echo ""

# ── 1. Проверяем/устанавливаем gh CLI ─────────────────────────────────────────
if ! command -v gh &>/dev/null; then
  echo "📦 Устанавливаем GitHub CLI (gh)..."
  if command -v brew &>/dev/null; then
    brew install gh
  else
    echo "❌ Homebrew не найден. Устанавливаем Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    brew install gh
  fi
fi

echo "✅ GitHub CLI готов"
echo ""

# ── 2. Авторизация ────────────────────────────────────────────────────────────
if ! gh auth status &>/dev/null; then
  echo "🔐 Нужно войти в GitHub. Откроется браузер..."
  echo ""
  gh auth login --web --git-protocol https
  echo ""
fi

echo "✅ Авторизация пройдена"
echo ""

# ── 3. Инициализируем git ─────────────────────────────────────────────────────
if [ ! -d ".git" ]; then
  echo "📁 Инициализируем git..."
  git init
  git branch -M main
fi

# ── 4. Первый коммит ──────────────────────────────────────────────────────────
echo "📝 Добавляем файлы..."
git add .
git commit -m "Initial commit: Rental management system" 2>/dev/null || \
  echo "   (нет новых изменений для коммита)"
echo ""

# ── 5. Создаём репозиторий на GitHub ─────────────────────────────────────────
REPO_NAME="rental-management"

if gh repo view "$REPO_NAME" &>/dev/null; then
  echo "ℹ️  Репозиторий $REPO_NAME уже существует"
else
  echo "🏗️  Создаём приватный репозиторий $REPO_NAME на GitHub..."
  gh repo create "$REPO_NAME" --private --source=. --remote=origin --push
  echo ""
  echo "✅ Репозиторий создан и код загружен!"
fi

# ── 6. Добавляем remote если его нет ─────────────────────────────────────────
if ! git remote get-url origin &>/dev/null; then
  GITHUB_USER=$(gh api user --jq '.login')
  git remote add origin "https://github.com/$GITHUB_USER/$REPO_NAME.git"
fi

# ── 7. Пушим ─────────────────────────────────────────────────────────────────
echo "⬆️  Отправляем код на GitHub..."
git push -u origin main 2>&1 || git push origin main 2>&1

echo ""
GITHUB_USER=$(gh api user --jq '.login' 2>/dev/null)
REPO_URL="https://github.com/$GITHUB_USER/$REPO_NAME"

echo "══════════════════════════════════════════════"
echo "   ✅ ГОТОВО!"
echo ""
echo "   📂 Репозиторий:"
echo "   $REPO_URL"
echo ""
echo "   🌐 Следующий шаг — Vercel:"
echo "   https://vercel.com/new"
echo "   → Import Git Repository"
echo "   → Выберите $REPO_NAME"
echo "══════════════════════════════════════════════"
echo ""

# Открываем репозиторий в браузере
open "$REPO_URL" 2>/dev/null

read -p "Нажмите Enter для выхода..."
