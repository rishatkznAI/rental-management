const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildZipArchive, normalizeZipPath, readFileEntry } = require('./zip-store');

const APP_NAME = 'Skytech Rental Management';
const BACKUP_WARNING = 'Не хранить в Git / содержит чувствительные данные.';
const DEFAULT_FILE_DIR_NAMES = ['uploads', 'photos', 'documents', 'files', 'attachments'];
const FILE_REFERENCE_KEYS = new Set([
  'photo',
  'photos',
  'image',
  'images',
  'file',
  'files',
  'attachment',
  'attachments',
  'url',
  'dataurl',
  'base64',
  'filename',
  'localpath',
  'originalurl',
  'mimetype',
]);
const IMAGE_MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

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
    base.endsWith('.zip') ||
    base === '.env' ||
    base.startsWith('.env.') ||
    base.endsWith('.env') ||
    base.endsWith('.log');
}

function isInsideDir(filePath, dir) {
  const relative = path.relative(path.resolve(dir), path.resolve(filePath));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function safeZipSegment(value, fallback = 'record') {
  const normalized = String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function dataUrlImage(value) {
  const match = String(value || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const ext = IMAGE_MIME_EXTENSIONS[mimeType];
  if (!ext) return { mimeType, ext: '', data: null };
  return {
    mimeType,
    ext,
    data: Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
  };
}

function safeDomain(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.hostname.toLowerCase();
  } catch {
    return '';
  }
}

function localReferenceCandidate(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 1024) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) return '';
  if (path.isAbsolute(text) && !/^\/(uploads|photos|documents|files|attachments)\//i.test(text)) return '';
  if (!/[\\/]/.test(text)) return '';
  return text;
}

function resolveLocalReference(value, roots) {
  const candidate = localReferenceCandidate(value);
  if (!candidate) return { filePath: '', reason: '' };
  const normalized = candidate.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.split('/').some(part => part === '..')) {
    return { filePath: '', reason: 'path-traversal' };
  }

  const existingRoots = roots
    .filter(root => root?.dir && fs.existsSync(root.dir))
    .map(root => ({ ...root, dir: fs.realpathSync(root.dir) }));

  for (const root of existingRoots) {
    const label = normalizeZipPath(root.label);
    const withoutLabel = normalized.startsWith(`${label}/`)
      ? normalized.slice(label.length + 1)
      : (normalized.startsWith(`data/${label}/`) ? normalized.slice(label.length + 6) : normalized);
    const fullPath = path.resolve(root.dir, withoutLabel);
    if (!isInsideDir(fullPath, root.dir)) return { filePath: '', reason: 'path-traversal' };
    if (!fs.existsSync(fullPath)) continue;
    const real = fs.realpathSync(fullPath);
    if (!isInsideDir(real, root.dir)) return { filePath: '', reason: 'path-traversal' };
    if (!fs.statSync(real).isFile()) return { filePath: '', reason: 'not-file' };
    if (shouldSkipFile(real)) return { filePath: '', reason: 'blocked-extension' };
    return {
      filePath: real,
      root,
      zipPath: `files/${label}/${normalizeZipPath(path.relative(root.dir, real))}`,
      reason: '',
    };
  }

  return { filePath: '', reason: 'missing-local-file' };
}

function recordId(record, index) {
  if (record && typeof record === 'object') {
    for (const key of ['id', '_id', 'uuid', 'rentalId', 'equipmentId']) {
      if (typeof record[key] === 'string' || typeof record[key] === 'number') return record[key];
    }
  }
  return `record-${index + 1}`;
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function skippedFileReason(error, fallback = 'read-file-failed') {
  const code = typeof error?.code === 'string' ? error.code.toLowerCase() : '';
  if (code === 'enoent') return 'missing-local-file';
  if (code === 'eacces' || code === 'eperm') return 'unreadable-local-file';
  if (code === 'enotdir') return 'not-file';
  return fallback;
}

function scanEmbeddedAndReferencedFiles({ readData, collections, roots, now, seenFiles }) {
  const entries = [];
  const includedLocalFiles = [];
  const embeddedPhotoCollections = {};
  const externalCollections = {};
  const externalDomains = {};
  const skippedReasons = {};
  let embeddedPhotosCount = 0;
  let externalReferencesCount = 0;
  let skippedFilesCount = 0;

  function skip(reason) {
    skippedFilesCount += 1;
    increment(skippedReasons, reason || 'unknown');
  }

  function inspectValue(value, context) {
    if (typeof value === 'string') {
      const embedded = dataUrlImage(value);
      if (embedded) {
        if (!embedded.data || !embedded.ext) {
          skip(`unsupported-mime:${embedded.mimeType || 'unknown'}`);
          return;
        }
        const zipPath = `files/embedded-photos/${safeZipSegment(context.collection, 'collection')}/${safeZipSegment(context.recordId)}/${safeZipSegment(context.fieldName, 'field')}-${context.index}.${embedded.ext}`;
        entries.push({ name: zipPath, data: embedded.data, mtime: now });
        embeddedPhotosCount += 1;
        increment(embeddedPhotoCollections, context.collection);
        return;
      }

      const domain = safeDomain(value);
      if (domain) {
        externalReferencesCount += 1;
        increment(externalCollections, context.collection);
        increment(externalDomains, domain);
        return;
      }

      const local = resolveLocalReference(value, roots);
      if (local.filePath) {
        if (seenFiles.has(local.filePath)) return;
        seenFiles.add(local.filePath);
        try {
          const fileEntry = readFileEntry(local.filePath, local.zipPath);
          entries.push(fileEntry);
          includedLocalFiles.push({ path: local.zipPath, size: fileEntry.size });
        } catch (error) {
          skip(skippedFileReason(error));
        }
      } else if (local.reason) {
        skip(local.reason);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => inspectValue(item, { ...context, index }));
      return;
    }

    if (value && typeof value === 'object') {
      let objectHadFileLikeKey = false;
      for (const [key, nested] of Object.entries(value)) {
        const keyLower = key.toLowerCase();
        if (FILE_REFERENCE_KEYS.has(keyLower)) {
          objectHadFileLikeKey = true;
          inspectValue(nested, { ...context, fieldName: key, index: context.index });
        } else if (nested && typeof nested === 'object') {
          inspectValue(nested, context);
        }
      }
      if (objectHadFileLikeKey && !Array.isArray(value)) {
        // Object references are intentionally summarized in the manifest instead of serialized.
      }
    }
  }

  for (const collection of collections) {
    const records = readData(collection);
    const list = Array.isArray(records)
      ? records
      : (records && typeof records === 'object' ? Object.values(records) : []);
    list.forEach((record, index) => {
      inspectValue(record, {
        collection,
        recordId: recordId(record, index),
        fieldName: 'photo',
        index: 0,
      });
    });
  }

  return {
    entries,
    includedLocalFiles,
    embeddedPhotosCount,
    externalReferencesCount,
    skippedFilesCount,
    skippedReasons,
    embeddedPhotoCollections,
    externalCollections,
    externalDomains,
  };
}

function collectLocalFiles(roots = defaultFileRoots(), seen = new Set()) {
  const entries = [];
  const missing = [];
  const skippedReasons = {};
  let skippedFilesCount = 0;

  function skip(reason) {
    skippedFilesCount += 1;
    increment(skippedReasons, reason || 'unknown');
  }

  function visit(root, currentDir) {
    let dirents = [];
    try {
      dirents = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (error) {
      skip(skippedFileReason(error, 'read-directory-failed'));
      return;
    }

    for (const dirent of dirents) {
      const fullPath = path.join(currentDir, dirent.name);
      if (dirent.isDirectory()) {
        visit(root, fullPath);
        continue;
      }
      if (!dirent.isFile() || shouldSkipFile(fullPath)) continue;
      let real = '';
      try {
        real = fs.realpathSync(fullPath);
      } catch (error) {
        skip(skippedFileReason(error));
        continue;
      }
      if (seen.has(real)) continue;
      seen.add(real);
      const relative = normalizeZipPath(path.relative(root.dir, fullPath));
      if (!relative) continue;
      entries.push({
        filePath: fullPath,
        realPath: real,
        zipPath: `files/${normalizeZipPath(root.label)}/${relative}`,
      });
    }
  }

  for (const root of roots) {
    if (!root?.dir || !fs.existsSync(root.dir)) {
      missing.push(root?.dir || '');
      continue;
    }
    let stat = null;
    try {
      stat = fs.statSync(root.dir);
    } catch (error) {
      skip(skippedFileReason(error, 'read-directory-failed'));
      continue;
    }
    if (!stat.isDirectory()) {
      missing.push(root.dir);
      continue;
    }
    visit(root, root.dir);
  }

  return { entries, missing, skippedFilesCount, skippedReasons };
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
  const skippedReasons = {};
  let skippedFilesCount = 0;

  function skip(reason) {
    skippedFilesCount += 1;
    increment(skippedReasons, reason || 'unknown');
  }

  function mergeSkipped(source = {}) {
    for (const [reason, count] of Object.entries(source)) {
      increment(skippedReasons, reason, count);
    }
  }

  let stage = 'init';
  try {
    stage = 'snapshot';
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

    stage = 'collect-files';
    const localFiles = collectLocalFiles(fileRoots || defaultFileRoots(dbPath));
    skippedFilesCount += localFiles.skippedFilesCount || 0;
    mergeSkipped(localFiles.skippedReasons);
    for (const item of localFiles.entries) {
      try {
        const fileEntry = readFileEntry(item.filePath, item.zipPath);
        entries.push(fileEntry);
        includedFiles.push({ path: item.zipPath, size: fileEntry.size });
      } catch (error) {
        skip(skippedFileReason(error));
      }
    }

    stage = 'scan-references';
    const embeddedAndReferencedFiles = scanEmbeddedAndReferencedFiles({
      readData,
      collections,
      roots: fileRoots || defaultFileRoots(dbPath),
      now,
      seenFiles: new Set(localFiles.entries.map(item => item.realPath || item.filePath).filter(Boolean)),
    });
    for (const item of embeddedAndReferencedFiles.entries) {
      entries.push(item);
    }
    for (const item of embeddedAndReferencedFiles.includedLocalFiles) {
      includedFiles.push(item);
    }
    const totalSkippedReasons = { ...skippedReasons };
    for (const [reason, count] of Object.entries(embeddedAndReferencedFiles.skippedReasons)) {
      increment(totalSkippedReasons, reason, count);
    }
    const totalSkippedFilesCount = skippedFilesCount + embeddedAndReferencedFiles.skippedFilesCount;

    const counts = {};
    for (const collection of collections) {
      counts[collection] = countCollection(readData(collection));
    }

    stage = 'zip';
    const includedFilesCount = includedFiles.length + embeddedAndReferencedFiles.embeddedPhotosCount;
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
        includedCount: includedFilesCount,
        includedFilesCount,
        localFilesCount: includedFiles.length,
        embeddedPhotosCount: embeddedAndReferencedFiles.embeddedPhotosCount,
        externalReferencesCount: embeddedAndReferencedFiles.externalReferencesCount,
        skippedFilesCount: totalSkippedFilesCount,
        skippedReasons: totalSkippedReasons,
        fileRootsChecked: (fileRoots || defaultFileRoots(dbPath)).map(root => path.basename(root?.dir || root?.label || '')).filter(Boolean),
        embeddedPhotoCollections: embeddedAndReferencedFiles.embeddedPhotoCollections,
        externalFileReferences: {
          count: embeddedAndReferencedFiles.externalReferencesCount,
          collections: embeddedAndReferencedFiles.externalCollections,
          domains: embeddedAndReferencedFiles.externalDomains,
          note: 'External URLs are referenced but not downloaded',
        },
        missingLocalFileRoots: localFiles.missing.filter(Boolean).map(item => path.basename(item)),
        note: includedFiles.length
          ? 'Локальные файлы включены из настроенных директорий.'
          : 'Локальные файлы/фото не найдены. SQLite snapshot всегда содержит исходные JSON-данные приложения.',
      },
      includedFilesCount,
      localFilesCount: includedFiles.length,
      embeddedPhotosCount: embeddedAndReferencedFiles.embeddedPhotosCount,
      externalReferencesCount: embeddedAndReferencedFiles.externalReferencesCount,
      skippedFilesCount: totalSkippedFilesCount,
      skippedReasons: totalSkippedReasons,
      fileRootsChecked: (fileRoots || defaultFileRoots(dbPath)).map(root => path.basename(root?.dir || root?.label || '')).filter(Boolean),
      embeddedPhotoCollections: embeddedAndReferencedFiles.embeddedPhotoCollections,
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
        'База данных всегда находится внутри архива как database/app.sqlite.',
        'Локальные файлы и фото включаются при наличии в разрешённых директориях data/uploads, data/photos, data/documents, data/files, data/attachments.',
        'Фото, сохранённые внутри JSON как data:image/...;base64, выгружаются отдельно в files/embedded-photos.',
        'Внешние URL учитываются в manifest.json, но не скачиваются.',
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
    if (error && typeof error === 'object' && !error.backupStage) {
      error.backupStage = typeof stage === 'string' ? stage : 'unknown';
    }
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
