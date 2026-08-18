const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  cleanupBackupArchive,
  createFullBackupArchive,
} = require('../lib/full-backup');
const {
  applyReset,
  assertProductionConservation,
  buildResetPlan,
  fileSha256,
  purgeQuarantine,
  retentionSnapshot,
  validateProductionBackup,
} = require('../lib/skytech-clean-production-reset');

function enabled() {
  return process.env.SKYTECH_CLEAN_RESET_ENABLED === 'true';
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

function safeBackupPath(dbPath, filename) {
  const safeName = path.basename(String(filename || ''));
  if (!/^skytech-pre-clean-reset-\d{8}T\d{6}Z\.zip$/.test(safeName)) {
    throw new Error('Invalid reset backup filename.');
  }
  return path.join(path.dirname(path.resolve(dbPath)), 'backups', safeName);
}

function safeQuarantinePath(dbPath, name) {
  const safeName = path.basename(String(name || ''));
  if (!/^\.skytech-reset-quarantine-\d{8}T\d{6,9}Z$/.test(safeName)) {
    throw new Error('Invalid reset quarantine name.');
  }
  return path.join(path.dirname(path.resolve(dbPath)), safeName);
}

function registerSkytechCleanResetRoutes(router, deps) {
  const {
    dbPath,
    ensureDb,
    readData,
    createSqliteBackup,
    buildInfo,
    getAppDisabledConfig = () => ({ disabled: false }),
    getBotDisabledConfig = () => ({ disabled: false }),
    getGsmDisabledConfig = () => ({ disabled: false }),
  } = deps;
  let operationInFlight = false;

  function conservationState() {
    return {
      appDisabled: getAppDisabledConfig()?.disabled === true,
      botDisabled: getBotDisabledConfig()?.disabled === true,
      gsmDisabled: getGsmDisabledConfig()?.disabled === true,
    };
  }

  function requireResetToken(req, res, next) {
    if (!enabled()) return res.status(404).json({ ok: false, error: 'Not found' });
    const expected = process.env.SKYTECH_CLEAN_RESET_TOKEN;
    if (!safeEqual(req.headers['x-skytech-reset-token'], expected) || String(expected || '').length < 32) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    return next();
  }

  function exclusive(handler) {
    return async (req, res) => {
      if (operationInFlight) return res.status(409).json({ ok: false, error: 'Reset operation already in progress.' });
      operationInFlight = true;
      try {
        return await handler(req, res);
      } catch (error) {
        console.error('[skytech-clean-reset] operation failed', {
          mode: req.path.split('/').pop(),
          code: typeof error?.code === 'string' ? error.code : 'RESET_OPERATION_FAILED',
        });
        return res.status(409).json({ ok: false, error: error?.message || 'Reset operation failed.' });
      } finally {
        operationInFlight = false;
      }
    };
  }

  router.post('/admin/skytech-clean-reset/backup', requireResetToken, exclusive(async (_req, res) => {
    assertProductionConservation(conservationState());
    const db = ensureDb();
    const now = new Date();
    const filename = `skytech-pre-clean-reset-${backupTimestamp(now)}.zip`;
    const outputPath = safeBackupPath(dbPath, filename);
    if (fs.existsSync(outputPath)) throw new Error('Reset backup already exists.');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    const collections = db.prepare('SELECT name FROM app_data ORDER BY name').all().map((row) => row.name);
    let backup = null;
    let published = false;
    try {
      backup = await createFullBackupArchive({
        readData,
        dbPath,
        createDatabaseBackup: createSqliteBackup,
        collections,
        buildInfo: typeof buildInfo === 'function' ? buildInfo() : null,
        now,
      });
      if (backup.manifest?.database?.includedAs !== 'database/app.sqlite') {
        throw new Error('Reset backup did not include a coherent SQLite snapshot.');
      }
      if (Number(backup.manifest?.skippedFilesCount) !== 0) {
        throw new Error('Reset backup is incomplete because one or more business files were skipped.');
      }
      const plan = buildResetPlan(db, { dbPath });
      if (plan.blockers.length > 0) {
        throw new Error(`Reset backup source failed discovery: ${plan.blockers.join('; ')}`);
      }
      const validation = validateProductionBackup(db, plan, backup.path);
      fs.copyFileSync(backup.path, outputPath, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(outputPath, 0o600);
      const sha256 = fileSha256(outputPath);
      published = true;
      return res.status(201).json({
        ok: true,
        backup: {
          filename,
          size: fs.statSync(outputPath).size,
          sha256,
          generatedAt: now.toISOString(),
          databaseIncludedAs: backup.manifest?.database?.includedAs,
          collectionCounts: backup.manifest?.counts || {},
          includedFilesCount: backup.manifest?.includedFilesCount || 0,
          skippedFilesCount: backup.manifest?.skippedFilesCount || 0,
          databaseIntegrity: validation.databaseIntegrity,
          databaseForeignKeyViolations: validation.databaseForeignKeyViolations,
          logicalDatabaseSha256: validation.logicalDatabaseSha256,
        },
      });
    } finally {
      if (!published && fs.existsSync(outputPath)) fs.rmSync(outputPath, { force: true });
      if (backup) cleanupBackupArchive(backup);
    }
  }));

  router.get('/admin/skytech-clean-reset/dry-run', requireResetToken, exclusive(async (_req, res) => {
    const result = buildResetPlan(ensureDb(), { dbPath });
    return res.json({ ok: result.blockers.length === 0, result });
  }));

  router.post('/admin/skytech-clean-reset/apply', requireResetToken, exclusive(async (req, res) => {
    const backupPath = safeBackupPath(dbPath, req.body?.backupFilename);
    const result = applyReset(ensureDb(), {
      dbPath,
      environment: 'production',
      confirm: req.body?.confirmation,
      backupPath,
      backupSha256: req.body?.backupSha256,
      preResetAudit: req.body?.preResetAudit,
      conservationState: conservationState(),
      cleanupFiles: true,
    });
    return res.json({ ok: true, result });
  }));

  router.get('/admin/skytech-clean-reset/verify', requireResetToken, exclusive(async (_req, res) => {
    const db = ensureDb();
    const result = buildResetPlan(db, { dbPath });
    const businessCollectionsRemaining = result.deleteCollections.filter((row) => row.count > 0);
    const businessTablesRemaining = result.deleteTables.filter((row) => row.count > 0);
    return res.json({
      ok: result.blockers.length === 0
        && businessCollectionsRemaining.length === 0
        && businessTablesRemaining.length === 0
        && result.database.foreignKeyViolations === 0
        && result.database.integrity?.[0]?.integrity_check === 'ok',
      result,
      retention: retentionSnapshot(db),
      businessCollectionsRemaining,
      businessTablesRemaining,
    });
  }));

  router.post('/admin/skytech-clean-reset/purge-quarantine', requireResetToken, exclusive(async (req, res) => {
    assertProductionConservation(conservationState());
    const backupPath = safeBackupPath(dbPath, req.body?.backupFilename);
    const quarantinePath = safeQuarantinePath(dbPath, req.body?.quarantine);
    const result = purgeQuarantine({
      dbPath,
      quarantinePath,
      confirm: req.body?.confirmation,
      backupPath,
      backupSha256: req.body?.backupSha256,
    });
    return res.json({ ok: true, result });
  }));
}

module.exports = {
  backupTimestamp,
  registerSkytechCleanResetRoutes,
  safeBackupPath,
  safeQuarantinePath,
};
