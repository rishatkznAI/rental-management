const fs = require('fs');
const path = require('path');

const CRM_ARCHIVE_SETTING_KEY = 'crm_archive_state';
const CRM_ARCHIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STARTUP_BUSINESS_MAINTENANCE_ENV = 'STARTUP_BUSINESS_MAINTENANCE';
// The eight mixed catalogues may contain unscoped platform defaults plus exact-
// tenant entries/overrides. Process startup is not their provisioning lifecycle:
// it must neither clone defaults into tenants nor create or rewrite either
// partition. A future platform-default seed requires explicit trusted platform
// authority outside normal startup.
const STARTUP_GLOBAL_REFERENCE_COLLECTIONS = Object.freeze([]);
const STARTUP_SYSTEM_IDENTITY_COLLECTIONS = Object.freeze(['users']);

function isStartupBusinessMaintenanceEnabled(_env = process.env) {
  // Startup is deliberately never a business-data migration runner. Tenant
  // maintenance requires a verified tenant scope, backup, dry-run manifest,
  // and an explicit operator-controlled command outside process startup.
  return false;
}

function logStartupBusinessMaintenanceDisabled(logger = console) {
  logger.warn?.(
    `[startup] business data maintenance is disabled, including when ${STARTUP_BUSINESS_MAINTENANCE_ENV}=apply. `
    + 'Use the scoped maintenance runner after a verified backup.',
  );
}

function runStartupPlatformOperation({
  runWithPlatformSystemScope,
  reason,
  writableCollections = [],
  operation,
}) {
  if (typeof runWithPlatformSystemScope !== 'function') {
    const error = new Error('Startup platform scope runner is required.');
    error.code = 'STARTUP_PLATFORM_SCOPE_REQUIRED';
    throw error;
  }
  if (typeof operation !== 'function') {
    throw new TypeError('Startup platform operation must be a function.');
  }
  return runWithPlatformSystemScope({
    reason: String(reason || '').trim(),
    writableCollections: [...new Set(writableCollections)],
  }, operation);
}

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
    throw error;
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
    throw error;
  }
}

function ensureKnowledgeBaseProgress({ readData, writeData }) {
  const existing = readData('knowledge_base_progress');
  if (Array.isArray(existing)) return;
  writeData('knowledge_base_progress', []);
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
    throw error;
  }
}

function seedSpareParts({ readData, writeDataBatch, normalizeSparePartRecord, seedsDir, logger = console }) {
  try {
    const existing = readData('spare_parts') || [];
    const existingCatalog = readData('spare_parts_catalog') || [];
    // Seed data is a bootstrap default, never an authoritative replacement.
    // Any existing catalogue (including a small custom legacy catalogue) wins.
    if (existing.length > 0 || existingCatalog.length > 0) return;
    const seedPath = path.join(seedsDir, 'spare_parts.json');
    if (!fs.existsSync(seedPath)) return;
    const parts = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
    if (!Array.isArray(parts) || parts.length === 0) return;
    const normalized = parts.map(item => normalizeSparePartRecord(item));
    writeDataBatch([
      { name: 'spare_parts', value: normalized },
      { name: 'spare_parts_catalog', value: normalized },
    ]);
    logger.log(`✓ Справочник запчастей загружен из seed: ${normalized.length} записей`);
  } catch (error) {
    logger.warn('seedSpareParts error:', error.message);
    throw error;
  }
}

function cleanupArchivedCrm({ readData, writeData, logger = console }) {
  try {
    const settings = readData('app_settings') || [];
    const idx = settings.findIndex(item => item?.key === CRM_ARCHIVE_SETTING_KEY);
    if (idx === -1) return;

    const setting = settings[idx];
    const raw = setting?.value && typeof setting.value === 'object' ? setting.value : {};
    const status = raw?.status;
    if (status !== 'archived') return;

    const archivedAtMs = Date.parse(raw.archivedAt || setting.updatedAt || setting.createdAt || '');
    const deleteAfterMs = Date.parse(raw.deleteAfter || '')
      || (Number.isNaN(archivedAtMs) ? NaN : archivedAtMs + CRM_ARCHIVE_TTL_MS);
    if (Number.isNaN(deleteAfterMs) || Date.now() < deleteAfterMs) return;

    const deals = Array.isArray(readData('crm_deals')) ? readData('crm_deals') : [];
    writeData('crm_deals', []);

    settings[idx] = {
      ...setting,
      updatedAt: new Date().toISOString(),
      value: {
        ...raw,
        status: 'deleted',
        deletedAt: new Date().toISOString(),
        deleteAfter: new Date(deleteAfterMs).toISOString(),
        purgedDealsCount: deals.length,
      },
    };
    writeData('app_settings', settings);
    logger.log(`✓ Архив CRM истёк, сделки очищены: ${deals.length}`);
  } catch (error) {
    logger.warn('cleanupArchivedCrm error:', error.message);
    throw error;
  }
}

async function startServer({ app, port, deps, logger = console }) {
  const {
    migrateJsonFilesToDb,
    cleanupExpiredSessions,
    seedDefaultUsers,
    ensureLegacyDefaultUsers,
    backfillServiceTicketCreatedAt,
    logGanttRentalLinkDiagnostics,
    applyAdminResetFromEnv,
    registerWebhook,
    startWebhookWatchdog,
    startBotPolling,
    startGprsGateway,
    startWialonIpsGateway,
    stopGprsGateway,
    stopWialonIpsGateway,
    dbPath,
    botToken,
    productionScopeWriteFreezeEnabled = false,
    productionValidationReadOnlyEnabled = false,
    runWithPlatformSystemScope,
  } = deps;
  const startupMutationSuppressed = productionScopeWriteFreezeEnabled
    || productionValidationReadOnlyEnabled;

  // Legacy JSON import and all business-data migrations are intentionally not
  // process-start hooks. They can span tenants and therefore belong in the
  // backed-up, manifest-driven remediation runner.
  if (!startupMutationSuppressed && typeof migrateJsonFilesToDb === 'function') {
    logger.warn?.('[startup] automatic legacy JSON migration is disabled; use the scoped migration runner.');
  }
  let warrantyFactoryPreflight = null;
  if (typeof deps.auditWarrantyClaimFactoryCounterpartyRelations === 'function') {
    warrantyFactoryPreflight = runStartupPlatformOperation({
      runWithPlatformSystemScope,
      reason: 'startup-warranty-factory-readonly-preflight',
      writableCollections: [],
      operation: () => deps.auditWarrantyClaimFactoryCounterpartyRelations({ readData: deps.readData }),
    });
    if (warrantyFactoryPreflight?.strictRolloutReady === false) {
      for (const issue of warrantyFactoryPreflight.strictRolloutBlockers || []) {
        logger.error?.(
          `[warranty-factory-counterparty-relations] strict rollout blocker: warrantyClaimId=${issue.recordId || 'missing'} `
          + `classification=${issue.classification} code=${issue.code}`,
        );
      }
      const error = new Error(
        'Strict rollout blocked: active external Warranty claims have unresolved factory Counterparty relations.',
      );
      error.code = 'WARRANTY_FACTORY_STRICT_ROLLOUT_BLOCKED';
      error.details = { blockers: warrantyFactoryPreflight.strictRolloutBlockers || [] };
      throw error;
    }
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let gprsStartAttempted = false;
    let wialonStartAttempted = false;
    const rejectOnce = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const server = app.listen(port, async () => {
      try {
    runStartupPlatformOperation({
      runWithPlatformSystemScope,
      reason: 'startup-business-integrity-readonly-audit',
      writableCollections: [],
      operation: () => {
    if (typeof deps.auditCounterpartyRoleProfiles === 'function') {
      try {
        const result = deps.auditCounterpartyRoleProfiles({ readData: deps.readData });
        const summary = result?.summary || {};
        const log = summary.errors > 0 ? logger.warn : logger.log;
        log?.call(
          logger,
          `[counterparty-role-profiles] integrity audit: errors=${summary.errors || 0} `
          + `warnings=${summary.warnings || 0} blockedRoleRemovals=${summary.blockedRoleRemovals || 0}`,
        );
        for (const issue of [...(result?.errors || []), ...(result?.warnings || [])]) {
          logger.warn?.(
            `[counterparty-role-profiles] integrity issue: domain=${issue.domain} `
            + `recordId=${issue.recordId || 'missing'} code=${issue.code} `
            + `repairability=${issue.repairability}`,
          );
        }
      } catch (error) {
        logger.warn(`[counterparty-role-profiles] integrity audit failed: ${error?.message || String(error)}`);
        throw error;
      }
    }
    if (typeof deps.auditCounterpartyRelations === 'function') {
      try {
        const result = deps.auditCounterpartyRelations({ readData: deps.readData });
        const summary = result?.summary || {};
        const log = summary.broken > 0 || summary.repairable > 0 ? logger.warn : logger.log;
        log?.call(
          logger,
          `[counterparty-relations] integrity audit: healthy=${summary.healthy || 0} `
          + `repairable=${summary.repairable || 0} broken=${summary.broken || 0}`,
        );
        for (const issue of [...(result?.repairable || []), ...(result?.broken || [])]) {
          logger.warn?.(
            `[counterparty-relations] integrity issue: domain=${issue.domain} `
            + `recordId=${issue.recordId || 'missing'} code=${issue.code} `
            + `repairability=${issue.repairability}`,
          );
        }
      } catch (error) {
        logger.warn(`[counterparty-relations] integrity audit failed: ${error?.message || String(error)}`);
        throw error;
      }
    }
    if (typeof deps.auditRentalCounterpartyRelations === 'function') {
      try {
        const result = deps.auditRentalCounterpartyRelations({ readData: deps.readData });
        const summary = result?.summary || {};
        const log = summary.broken > 0 || summary.repairable > 0 ? logger.warn : logger.log;
        log?.call(
          logger,
          `[rental-counterparty-relations] integrity audit: healthy=${summary.healthy || 0} `
          + `repairable=${summary.repairable || 0} broken=${summary.broken || 0}`,
        );
        for (const issue of [...(result?.repairable || []), ...(result?.broken || [])]) {
          logger.warn?.(
            `[rental-counterparty-relations] integrity issue: rentalId=${issue.recordId || 'missing'} `
            + `code=${issue.code} repairability=${issue.repairability}`,
          );
        }
      } catch (error) {
        logger.warn(`[rental-counterparty-relations] integrity audit failed: ${error?.message || String(error)}`);
        throw error;
      }
    }
    if (typeof deps.auditDeliveryCounterpartyRelations === 'function') {
      try {
        const result = deps.auditDeliveryCounterpartyRelations({ readData: deps.readData });
        const classifications = result?.summary?.classifications || {};
        const hasIssues = (classifications.repairable || 0)
          + (classifications.conflicting || 0)
          + (classifications.unresolved || 0) > 0;
        const log = hasIssues ? logger.warn : logger.log;
        log?.call(
          logger,
          `[delivery-counterparty-relations] integrity audit: valid=${classifications.valid || 0} `
          + `repairable=${classifications.repairable || 0} conflicting=${classifications.conflicting || 0} `
          + `unresolved=${classifications.unresolved || 0}`,
        );
        for (const issue of (result?.entries || []).filter(entry => entry.classification !== 'valid')) {
          logger.warn?.(
            `[delivery-counterparty-relations] integrity issue: domain=${issue.domain} `
            + `recordId=${issue.recordId || 'missing'} code=${issue.code} `
            + `repairability=${issue.repairability}`,
          );
        }
      } catch (error) {
        logger.warn(`[delivery-counterparty-relations] integrity audit failed: ${error?.message || String(error)}`);
        throw error;
      }
    }
    if (typeof deps.auditServiceCounterpartyRelations === 'function') {
      try {
        const result = deps.auditServiceCounterpartyRelations({ readData: deps.readData });
        const classifications = result?.summary?.classifications || {};
        const hasIssues = (classifications.deterministic_repair || 0)
          + (result?.summary?.broken || 0) > 0;
        const log = hasIssues ? logger.warn : logger.log;
        log?.call(
          logger,
          `[service-counterparty-relations] integrity audit: canonical=${classifications.already_canonical || 0} `
          + `internal=${classifications.internal_unlinked_valid || 0} `
          + `repairable=${classifications.deterministic_repair || 0} broken=${result?.summary?.broken || 0}`,
        );
        for (const issue of (result?.entries || []).filter(entry => ![
          'already_canonical',
          'internal_unlinked_valid',
        ].includes(entry.classification))) {
          logger.warn?.(
            `[service-counterparty-relations] integrity issue: serviceTicketId=${issue.recordId || 'missing'} `
            + `classification=${issue.classification} code=${issue.code} repairability=${issue.repairability}`,
          );
        }
      } catch (error) {
        logger.warn(`[service-counterparty-relations] integrity audit failed: ${error?.message || String(error)}`);
        throw error;
      }
    }
    if (typeof deps.auditWarrantyClaimCounterpartyRelations === 'function') {
      try {
        const result = deps.auditWarrantyClaimCounterpartyRelations({ readData: deps.readData });
        const classifications = result?.summary?.classifications || {};
        const hasIssues = (classifications.deterministic_repair || 0)
          + (result?.summary?.broken || 0) > 0;
        const log = hasIssues ? logger.warn : logger.log;
        log?.call(
          logger,
          `[warranty-counterparty-relations] integrity audit: canonical=${classifications.already_canonical || 0} `
          + `internal=${classifications.internal_unlinked_valid || 0} `
          + `terminalHistory=${classifications.canonical_terminal_history || 0} `
          + `repairable=${classifications.deterministic_repair || 0} broken=${result?.summary?.broken || 0}`,
        );
        for (const issue of (result?.entries || []).filter(entry => ![
          'already_canonical',
          'internal_unlinked_valid',
          'canonical_terminal_history',
        ].includes(entry.classification))) {
          logger.warn?.(
            `[warranty-counterparty-relations] integrity issue: warrantyClaimId=${issue.recordId || 'missing'} `
            + `classification=${issue.classification} code=${issue.code} repairability=${issue.repairability}`,
          );
        }
      } catch (error) {
        logger.warn(`[warranty-counterparty-relations] integrity audit failed: ${error?.message || String(error)}`);
        throw error;
      }
    }
    if (typeof deps.auditWarrantyClaimFactoryCounterpartyRelations === 'function') {
      const result = warrantyFactoryPreflight;
      const classifications = result?.summary?.classifications || {};
      const unresolved = Number(result?.summary?.activeExternalUnresolved) || 0;
      const log = unresolved > 0 || Number(result?.summary?.broken) > 0 ? logger.warn : logger.log;
      log?.call(
        logger,
        `[warranty-factory-counterparty-relations] integrity audit: canonical=${classifications.canonical || 0} `
        + `preExternal=${classifications.valid_pre_external_draft || 0} `
        + `terminalHistory=${classifications.canonical_terminal_history || 0} `
        + `unresolvedTerminal=${classifications.unresolved_terminal_historical_snapshot || 0} `
        + `activeExternalUnresolved=${unresolved} broken=${result?.summary?.broken || 0}`,
      );
    }
      },
    });
    if (!startupMutationSuppressed) {
      cleanupExpiredSessions();
      runStartupPlatformOperation({
        runWithPlatformSystemScope,
        reason: 'startup-system-identity-bootstrap',
        writableCollections: STARTUP_SYSTEM_IDENTITY_COLLECTIONS,
        operation: () => {
          seedDefaultUsers();
          ensureLegacyDefaultUsers();
          applyAdminResetFromEnv();
        },
      });
    } else {
      logger.log(productionValidationReadOnlyEnabled
        ? '[production-validation] startup mutation paths skipped: validation read-only mode active'
        : '[production-scope-remediation] startup mutation paths skipped: write freeze active');
    }
    logStartupBusinessMaintenanceDisabled(logger);
    runStartupPlatformOperation({
      runWithPlatformSystemScope,
      reason: 'startup-business-diagnostics-readonly',
      writableCollections: [],
      operation: () => {
        if (typeof backfillServiceTicketCreatedAt === 'function') {
          const currentService = deps.readData('service') || [];
          const result = backfillServiceTicketCreatedAt(currentService, {
            nowIso: () => new Date().toISOString(),
          });
          if (result?.stats?.missingCreatedAt > 0) {
            logger.warn(`[service] createdAt backfill dry-run: missing=${result.stats.missingCreatedAt}, createdDate=${result.stats.fromCreatedDate}, date=${result.stats.fromDate}, requestedAt=${result.stats.fromRequestedAt}, updatedAt=${result.stats.fromUpdatedAt}, approximate=${result.stats.fromNow}`);
          }
          if (process.env.SERVICE_CREATED_AT_BACKFILL === 'apply') {
            logger.warn('[service] createdAt backfill startup apply disabled; no DB writes were performed. Run node server/scripts/backfill-service-created-at.js --apply after a verified backup.');
          }
        }
        if (typeof logGanttRentalLinkDiagnostics === 'function') {
          logGanttRentalLinkDiagnostics({
            readData: deps.readData,
            logger,
            targetId: process.env.GANTT_RENTAL_DIAG_TARGET || '',
          });
        }
      },
    });
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
    logger.log('║  GET  /api/company_expenses — расходы                ║');
    logger.log('║  ... и ещё 6 коллекций (PATCH/POST/DELETE/PUT)       ║');
    logger.log('╠══════════════════════════════════════════════════════╣');
    logger.log('║  GET  /health          — healthcheck                 ║');
    logger.log('║  GET  /api/status      — статус сервера (admin)      ║');
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

    if (!startupMutationSuppressed) {
      await registerWebhook();
      if (typeof startWebhookWatchdog === 'function') startWebhookWatchdog();
      if (typeof startBotPolling === 'function') startBotPolling();
      const startOptionalGateway = async ({ label, start, markAttempted }) => {
        if (typeof start !== 'function') return;
        markAttempted();
        try {
          await start();
        } catch (error) {
          // A telemetry transport is an optional runtime. Its own status keeps
          // the startError for readiness/diagnostics, while HTTP and the other
          // independent transport remain available for operators and clients.
          logger.error?.(`[startup] ${label} gateway unavailable; continuing in degraded mode`, {
            code: error?.code || 'GSM_GATEWAY_START_FAILED',
            message: error?.message || String(error),
          });
        }
      };
      await Promise.all([
        startOptionalGateway({
          label: 'GPRS',
          start: startGprsGateway,
          markAttempted: () => { gprsStartAttempted = true; },
        }),
        startOptionalGateway({
          label: 'Wialon IPS',
          start: startWialonIpsGateway,
          markAttempted: () => { wialonStartAttempted = true; },
        }),
      ]);
    } else {
      logger.log(productionValidationReadOnlyEnabled
        ? '[production-validation] bot and GSM/GPRS transports skipped: validation read-only mode active'
        : '[production-scope-remediation] bot and GSM/GPRS transports skipped: write freeze active');
    }
      settled = true;
      resolve(server);
      } catch (error) {
        const cleanupErrors = [];
        for (const [attempted, stop, label] of [
          [wialonStartAttempted, stopWialonIpsGateway, 'Wialon IPS'],
          [gprsStartAttempted, stopGprsGateway, 'GPRS'],
        ]) {
          if (!attempted || typeof stop !== 'function') continue;
          try {
            await stop();
          } catch (cleanupError) {
            cleanupErrors.push({
              transport: label,
              code: cleanupError?.code || 'STARTUP_TRANSPORT_CLEANUP_FAILED',
              message: cleanupError?.message || String(cleanupError),
            });
          }
        }
        if (cleanupErrors.length > 0) {
          error.cleanupErrors = cleanupErrors;
          logger.error?.('[startup] transport cleanup failed', cleanupErrors);
        }
        if (!server.listening) {
          rejectOnce(error);
          return;
        }
        server.close(closeError => {
          if (closeError) {
            error.cleanupErrors = [
              ...(error.cleanupErrors || []),
              {
                transport: 'HTTP',
                code: closeError?.code || 'STARTUP_HTTP_CLEANUP_FAILED',
                message: closeError?.message || String(closeError),
              },
            ];
            logger.error?.('[startup] HTTP cleanup failed', error.cleanupErrors.at(-1));
          }
          rejectOnce(error);
        });
      }
    });
    server.once('error', rejectOnce);
  });
}

module.exports = {
  STARTUP_BUSINESS_MAINTENANCE_ENV,
  STARTUP_GLOBAL_REFERENCE_COLLECTIONS,
  STARTUP_SYSTEM_IDENTITY_COLLECTIONS,
  ensureKnowledgeBaseProgress,
  isStartupBusinessMaintenanceEnabled,
  runStartupPlatformOperation,
  seedKnowledgeBaseModules,
  seedSpareParts,
  seedServiceRouteNorms,
  seedServiceWorks,
  cleanupArchivedCrm,
  startServer,
};
