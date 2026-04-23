const fs = require('fs');
const path = require('path');

function seedServiceWorks({ readData, writeData, normalizeServiceWorkRecord, seedsDir, logger = console }) {
  try {
    const existing = readData('service_works') || [];
    if (existing.length > 0) return;
    const seedPath = path.join(seedsDir, 'service_works.json');
    if (!fs.existsSync(seedPath)) return;
    const works = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
    if (!Array.isArray(works) || works.length === 0) return;
    const normalized = works.map(item => normalizeServiceWorkRecord(item));
    writeData('service_works', normalized);
    logger.log(`✓ Справочник работ загружен из seed: ${normalized.length} записей`);
  } catch (error) {
    logger.warn('seedServiceWorks error:', error.message);
  }
}

function seedKnowledgeBaseModules({ readData, writeData, seedsDir, logger = console }) {
  try {
    const existing = readData('knowledge_base_modules') || [];
    if (existing.length > 0) return;
    const seedPath = path.join(seedsDir, 'knowledge_base_modules.json');
    if (!fs.existsSync(seedPath)) return;
    const modules = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
    if (!Array.isArray(modules) || modules.length === 0) return;
    writeData('knowledge_base_modules', modules);
    logger.log(`✓ База знаний загружена из seed: ${modules.length} модулей`);
  } catch (error) {
    logger.warn('seedKnowledgeBaseModules error:', error.message);
  }
}

function ensureKnowledgeBaseProgress({ readData, writeData }) {
  const existing = readData('knowledge_base_progress');
  if (Array.isArray(existing)) return;
  writeData('knowledge_base_progress', []);
}

function hasSeededSpareParts(existing) {
  return existing.some(item => String(item.article || item.sku || '').startsWith('GEN-'));
}

function seedServiceRouteNorms({ readData, writeData, seedsDir, logger = console }) {
  try {
    const existing = readData('service_route_norms') || [];
    if (existing.length > 0) return;
    const seedPath = path.join(seedsDir, 'service_route_norms.json');
    if (!fs.existsSync(seedPath)) return;
    const routes = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
    if (!Array.isArray(routes) || routes.length === 0) return;
    writeData('service_route_norms', routes);
    logger.log(`✓ Справочник маршрутов выезда загружен из seed: ${routes.length} записей`);
  } catch (error) {
    logger.warn('seedServiceRouteNorms error:', error.message);
  }
}

function seedSpareParts({ readData, writeData, normalizeSparePartRecord, seedsDir, logger = console }) {
  try {
    const existing = readData('spare_parts') || [];
    const seedPath = path.join(seedsDir, 'spare_parts.json');
    if (!fs.existsSync(seedPath)) return;
    const parts = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
    if (!Array.isArray(parts) || parts.length === 0) return;
    if (existing.length >= parts.length && hasSeededSpareParts(existing)) return;

    const normalized = parts.map(item => normalizeSparePartRecord(item));
    writeData('spare_parts', normalized);
    writeData('spare_parts_catalog', normalized);
    logger.log(`✓ Справочник запчастей загружен из seed: ${normalized.length} записей`);
  } catch (error) {
    logger.warn('seedSpareParts error:', error.message);
  }
}

async function startServer({ app, port, deps, logger = console }) {
  const {
    migrateJsonFilesToDb,
    cleanupExpiredSessions,
    seedDefaultUsers,
    ensureLegacyDefaultUsers,
    migrateReferenceCollections,
    migrateLegacyRepairFacts,
    applyAdminResetFromEnv,
    registerWebhook,
    startGprsGateway,
    dbPath,
    botToken,
  } = deps;

  return app.listen(port, async () => {
    migrateJsonFilesToDb();
    cleanupExpiredSessions();
    seedDefaultUsers();
    ensureLegacyDefaultUsers();
    migrateReferenceCollections();
    migrateLegacyRepairFacts();
    seedServiceWorks({
      readData: deps.readData,
      writeData: deps.writeData,
      normalizeServiceWorkRecord: deps.normalizeServiceWorkRecord,
      seedsDir: deps.seedsDir,
      logger,
    });
    seedKnowledgeBaseModules({
      readData: deps.readData,
      writeData: deps.writeData,
      seedsDir: deps.seedsDir,
      logger,
    });
    ensureKnowledgeBaseProgress({
      readData: deps.readData,
      writeData: deps.writeData,
    });
    seedSpareParts({
      readData: deps.readData,
      writeData: deps.writeData,
      normalizeSparePartRecord: deps.normalizeSparePartRecord,
      seedsDir: deps.seedsDir,
      logger,
    });
    seedServiceRouteNorms({
      readData: deps.readData,
      writeData: deps.writeData,
      seedsDir: deps.seedsDir,
      logger,
    });
    applyAdminResetFromEnv();
    if (typeof startGprsGateway === 'function') {
      startGprsGateway();
    }

    logger.log('');
    logger.log('╔══════════════════════════════════════════════════════╗');
    logger.log('║  Rental Management Server — запущен!                 ║');
    logger.log(`║  http://localhost:${port}                                ║`);
    logger.log('╠══════════════════════════════════════════════════════╣');
    logger.log('║  POST /api/auth/login  — вход, получить токен        ║');
    logger.log('║  GET  /api/auth/me     — текущий пользователь        ║');
    logger.log('║  POST /api/auth/logout — выход                       ║');
    logger.log('║  GET  /api/equipment   — список техники               ║');
    logger.log('║  GET  /api/clients     — клиенты                     ║');
    logger.log('║  GET  /api/service     — сервисные заявки            ║');
    logger.log('║  GET  /api/rentals     — аренды                      ║');
    logger.log('║  GET  /api/payments    — платежи                     ║');
    logger.log('║  ... и ещё 5 коллекций (PATCH/POST/DELETE/PUT)       ║');
    logger.log('╠══════════════════════════════════════════════════════╣');
    logger.log('║  POST /api/sync        — bulk sync (legacy)          ║');
    logger.log('║  GET  /api/status      — статус сервера              ║');
    logger.log('║  POST /bot/webhook     — MAX бот webhook             ║');
    logger.log('╚══════════════════════════════════════════════════════╝');
    logger.log('');
    if (process.env.DB_PATH) {
      logger.log(`[DB] ✅  SQLite (persistent): ${dbPath}`);
    } else {
      logger.log(`[DB] SQLite: ${dbPath}`);
      logger.log('');
      logger.log('╔══════════════════════════════════════════════════════════════════╗');
      logger.log('║  ⚠️  ВНИМАНИЕ: DB_PATH не задан!                                ║');
      logger.log('║  База данных хранится внутри контейнера.                        ║');
      logger.log('║  При каждом деплое на Railway ВСЕ данные (включая сессии)       ║');
      logger.log('║  будут УНИЧТОЖЕНЫ — пользователи будут разлогинены.             ║');
      logger.log('║                                                                  ║');
      logger.log('║  Для постоянного хранения:                                      ║');
      logger.log('║    1. Создайте Volume в Railway (Settings → Volumes)            ║');
      logger.log('║    2. Mount path: /data                                         ║');
      logger.log('║    3. Добавьте env: DB_PATH=/data/app.sqlite                    ║');
      logger.log('╚══════════════════════════════════════════════════════════════════╝');
    }
    logger.log('');

    if (!botToken) {
      logger.log('⚠️  BOT_TOKEN не задан. Создайте файл .env:');
      logger.log('   BOT_TOKEN=ваш_токен_от_MAX');
      logger.log('');
    }

    await registerWebhook();
  });
}

module.exports = {
  ensureKnowledgeBaseProgress,
  seedKnowledgeBaseModules,
  seedSpareParts,
  seedServiceRouteNorms,
  seedServiceWorks,
  startServer,
};
