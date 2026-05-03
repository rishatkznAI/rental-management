const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildZipArchive, normalizeZipPath, readFileEntry } = require('./zip-store');

const APP_NAME = 'Skytech Rental Management';
const BACKUP_WARNING = 'Не хранить в Git / содержит чувствительные данные.';
const DEFAULT_FILE_DIR_NAMES = ['uploads', 'photos', 'documents', 'files', 'attachments'];

function backupTimestamp(date = new Date()) {
  return date.toISOString().slice(0, 16).replace('T', '-').replace(':', '-');
}

function backupFileName(date = new Date()) {
  return `skytech-backup-${backupTimestamp(date)}.zip`;
}

function countCollection(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

function defaultFileRoots(dbPath) {
  const dataDir = path.dirname(path.resolve(dbPath || path.join(__dirname, '..', 'data', 'app.sqlite')));
  return DEFAULT_FILE_DIR_NAMES.map(name => ({
    label: name,
    dir: path.join(dataDir, name),
  }));
}

function shouldSkipFile(filePath) {
  const base = path.basename(filePath).toLowerCase();
  return base.endsWith('.sqlite') ||
    base.endsWith('.sqlite-wal') ||
    base.endsWith('.sqlite-shm') ||
    base.endsWith('.db') ||
    base.endsWith('.zip');
}

function collectLocalFiles(roots = defaultFileRoots()) {
  const entries = [];
  const missing = [];
  const seen = new Set();

  function visit(root, currentDir) {
    for (const dirent of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, dirent.name);
      if (dirent.isDirectory()) {
        visit(root, fullPath);
        continue;
      }
      if (!dirent.isFile() || shouldSkipFile(fullPath)) continue;
      const real = fs.realpathSync(fullPath);
      if (seen.has(real)) continue;
      seen.add(real);
      const relative = normalizeZipPath(path.relative(root.dir, fullPath));
      if (!relative) continue;
      entries.push({
        filePath: fullPath,
        zipPath: `files/${normalizeZipPath(root.label)}/${relative}`,
      });
    }
  }

  for (const root of roots) {
    if (!root?.dir || !fs.existsSync(root.dir)) {
      missing.push(root?.dir || '');
      continue;
    }
    const stat = fs.statSync(root.dir);
    if (!stat.isDirectory()) {
      missing.push(root.dir);
      continue;
    }
    visit(root, root.dir);
  }

  return { entries, missing };
}

function buildDatabaseExport(readData, collections) {
  const data = {};
  for (const collection of collections) {
    data[collection] = readData(collection);
  }
  return {
    format: 'rental-management-full-database-export',
    exportedAt: new Date().toISOString(),
    collections: data,
  };
}

async function createFullBackupArchive({
  readData,
  dbPath,
  createDatabaseBackup,
  collections = [],
  buildInfo = null,
  fileRoots,
  now = new Date(),
} = {}) {
  if (typeof readData !== 'function') throw new Error('readData is required for backup');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skytech-backup-'));
  const filename = backupFileName(now);
  const zipPath = path.join(tempDir, filename);
  const dbSnapshotPath = path.join(tempDir, 'app.sqlite');
  const includedFiles = [];
  const entries = [];

  try {
    let databaseIncludedAs = '';
    if (typeof createDatabaseBackup === 'function') {
      await createDatabaseBackup(dbSnapshotPath);
      entries.push(readFileEntry(dbSnapshotPath, 'database/app.sqlite'));
      databaseIncludedAs = 'database/app.sqlite';
    } else if (dbPath && fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, dbSnapshotPath);
      entries.push(readFileEntry(dbSnapshotPath, 'database/app.sqlite'));
      databaseIncludedAs = 'database/app.sqlite';
    } else {
      const exportPayload = buildDatabaseExport(readData, collections);
      entries.push({
        name: 'database/database-export.json',
        data: JSON.stringify(exportPayload, null, 2),
        mtime: now,
      });
      databaseIncludedAs = 'database/database-export.json';
    }

    const localFiles = collectLocalFiles(fileRoots || defaultFileRoots(dbPath));
    for (const item of localFiles.entries) {
      const fileEntry = readFileEntry(item.filePath, item.zipPath);
      entries.push(fileEntry);
      includedFiles.push({ path: item.zipPath, size: fileEntry.size });
    }

    const counts = {};
    for (const collection of collections) {
      counts[collection] = countCollection(readData(collection));
    }

    const manifest = {
      generatedAt: now.toISOString(),
      appName: APP_NAME,
      appVersion: buildInfo,
      database: {
        type: 'sqlite',
        includedAs: databaseIncludedAs,
        sourcePath: dbPath ? path.basename(dbPath) : '',
      },
      counts,
      files: {
        included: includedFiles,
        includedCount: includedFiles.length,
        missingLocalFileRoots: localFiles.missing.filter(Boolean).map(item => path.basename(item)),
        note: includedFiles.length
          ? 'Локальные файлы включены из настроенных директорий.'
          : 'Локальные файлы/фото не найдены. Фото/вложения, сохранённые внутри SQLite JSON или как base64/URL-поля, находятся в database/app.sqlite.',
      },
      warning: BACKUP_WARNING,
    };

    entries.unshift({
      name: 'manifest.json',
      data: JSON.stringify(manifest, null, 2),
      mtime: now,
    });
    entries.push({
      name: 'README-backup.txt',
      data: [
        `${APP_NAME} backup`,
        '',
        BACKUP_WARNING,
        'Архив может содержать персональные, коммерческие и служебные данные.',
        'Не отправляйте архив в общий чат и не храните его в Git.',
        'Автоматическое восстановление из этого архива в приложении пока не реализовано.',
        '',
      ].join('\n'),
      mtime: now,
    });

    let finalZip = buildZipArchive(entries);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      manifest.backupSize = finalZip.length;
      entries[0] = {
        name: 'manifest.json',
        data: JSON.stringify(manifest, null, 2),
        mtime: now,
      };
      const nextZip = buildZipArchive(entries);
      finalZip = nextZip;
      if (nextZip.length === manifest.backupSize) break;
    }
    fs.writeFileSync(zipPath, finalZip, { mode: 0o600 });

    return {
      filename,
      path: zipPath,
      cleanupDir: tempDir,
      manifest,
      size: finalZip.length,
    };
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function cleanupBackupArchive(backup) {
  if (backup?.cleanupDir) {
    fs.rmSync(backup.cleanupDir, { recursive: true, force: true });
  }
}

module.exports = {
  BACKUP_WARNING,
  backupFileName,
  cleanupBackupArchive,
  collectLocalFiles,
  createFullBackupArchive,
};
