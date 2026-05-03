const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_ALLOWED_DOMAINS = ['i.oneme.ru'];
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_REFERENCE_KEYS = new Set([
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
  'originalurl',
]);
const IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordId(record, index) {
  if (isPlainObject(record)) {
    for (const key of ['id', '_id', 'uuid', 'rentalId', 'equipmentId']) {
      const value = record[key];
      if (typeof value === 'string' || typeof value === 'number') return String(value);
    }
  }
  return `record-${index + 1}`;
}

function safeSegment(value, fallback = 'item') {
  const text = String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return text || fallback;
}

function externalUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isDataUrl(value) {
  return typeof value === 'string' && /^data:image\/[^;]+;base64,/i.test(value);
}

function isLocalPath(value) {
  return typeof value === 'string' &&
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(value) &&
    /[\\/]/.test(value);
}

function shouldInspectField(key) {
  const lower = String(key || '').toLowerCase();
  return PHOTO_REFERENCE_KEYS.has(lower) || /photo|image|file|attach|url|base64|mimetype|filename/i.test(lower);
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function addDomain(summary, parsed) {
  if (parsed?.hostname) increment(summary.domains, parsed.hostname.toLowerCase());
}

function countStorage(summary, collection, fieldName, value) {
  const fieldKey = `${collection}.${fieldName}`;
  if (externalUrl(value)) {
    summary.found += 1;
    increment(summary.collections, collection);
    increment(summary.fields, fieldKey);
    addDomain(summary, externalUrl(value));
    return;
  }
  if (isDataUrl(value)) {
    summary.dataUrls += 1;
    increment(summary.storageTypes.dataUrl, fieldKey);
    return;
  }
  if (isLocalPath(value)) {
    summary.localPaths += 1;
    increment(summary.storageTypes.localPath, fieldKey);
    return;
  }
  if (isPlainObject(value) || Array.isArray(value)) {
    summary.objects += 1;
    increment(summary.storageTypes.object, fieldKey);
  }
}

function createSummary() {
  return {
    found: 0,
    archived: 0,
    skipped: 0,
    failed: 0,
    alreadyArchived: 0,
    dataUrls: 0,
    localPaths: 0,
    objects: 0,
    collections: {},
    fields: {},
    domains: {},
    skippedReasons: {},
    failedReasons: {},
    storageTypes: {
      dataUrl: {},
      localPath: {},
      object: {},
    },
  };
}

function extensionForMime(mimeType) {
  const normalized = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return IMAGE_EXTENSIONS[normalized] || '';
}

function localPathFor({ uploadsRoot, collection, recordId: id, originalUrl, mimeType }) {
  const ext = extensionForMime(mimeType);
  if (!ext) return null;
  const hash = crypto.createHash('sha256').update(originalUrl).digest('hex').slice(0, 32);
  const relative = path.join('external-photos', safeSegment(collection, 'collection'), safeSegment(id, 'record'), `${hash}.${ext}`);
  const absolute = path.resolve(uploadsRoot, relative);
  const root = path.resolve(uploadsRoot);
  const inside = path.relative(root, absolute);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return null;
  return {
    absolute,
    relative,
    publicPath: `/uploads/${relative.replace(/\\/g, '/')}`,
    filename: path.basename(absolute),
  };
}

async function writeArchivedPhoto({ uploadsRoot, collection, recordId: id, originalUrl, mimeType, bytes, nowIso }) {
  const location = localPathFor({ uploadsRoot, collection, recordId: id, originalUrl, mimeType });
  if (!location) {
    return { ok: false, code: 'unsupported-mime' };
  }
  fs.mkdirSync(path.dirname(location.absolute), { recursive: true, mode: 0o700 });
  fs.writeFileSync(location.absolute, bytes, { mode: 0o600 });
  return {
    ok: true,
    metadata: {
      originalUrl,
      localPath: location.publicPath,
      filename: location.filename,
      mimeType: String(mimeType || '').split(';')[0].trim().toLowerCase(),
      size: bytes.length,
      archivedAt: nowIso,
      archiveStatus: 'archived',
    },
  };
}

function safeFailure(originalUrl, code, nowIso) {
  return {
    originalUrl,
    archiveStatus: 'failed',
    archiveErrorCode: code || 'failed',
    archivedAt: nowIso,
  };
}

function safeSkip(originalUrl, code, nowIso) {
  return {
    originalUrl,
    archiveStatus: 'skipped',
    archiveErrorCode: code || 'skipped',
    archivedAt: nowIso,
  };
}

async function archiveExternalPhotos({
  readData,
  writeData,
  collections,
  uploadsRoot,
  allowDomains = DEFAULT_ALLOWED_DOMAINS,
  downloadPhoto,
  dryRun = true,
  now = new Date(),
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  if (typeof readData !== 'function') throw new Error('readData is required');
  if (!dryRun && typeof writeData !== 'function') throw new Error('writeData is required');
  if (!dryRun && typeof downloadPhoto !== 'function') throw new Error('downloadPhoto is required');

  const allowed = new Set((Array.isArray(allowDomains) ? allowDomains : [])
    .map(item => String(item || '').trim().toLowerCase())
    .filter(Boolean));
  const root = path.resolve(uploadsRoot || path.join(process.cwd(), 'data', 'uploads'));
  const nowIso = now.toISOString();
  const summary = createSummary();
  const changedCollections = new Map();

  async function archiveUrl(url, context) {
    const parsed = externalUrl(url);
    if (!parsed) return { changed: false, value: url };
    summary.found += 1;
    increment(summary.collections, context.collection);
    increment(summary.fields, `${context.collection}.${context.fieldName}`);
    addDomain(summary, parsed);

    const domain = parsed.hostname.toLowerCase();
    if (!allowed.has(domain)) {
      summary.skipped += 1;
      increment(summary.skippedReasons, 'domain-not-allowed');
      return { changed: false, value: dryRun ? url : safeSkip(url, 'domain-not-allowed', nowIso) };
    }
    if (dryRun) return { changed: false, value: url };

    try {
      const downloaded = await downloadPhoto(url, { maxBytes, domain, collection: context.collection });
      const mimeType = String(downloaded?.mimeType || '').split(';')[0].trim().toLowerCase();
      const bytes = Buffer.isBuffer(downloaded?.bytes) ? downloaded.bytes : Buffer.from(downloaded?.bytes || []);
      if (!mimeType.startsWith('image/')) {
        summary.skipped += 1;
        increment(summary.skippedReasons, 'non-image-content');
        return { changed: true, value: safeSkip(url, 'non-image-content', nowIso) };
      }
      if (!extensionForMime(mimeType)) {
        summary.skipped += 1;
        increment(summary.skippedReasons, 'unsupported-mime');
        return { changed: true, value: safeSkip(url, 'unsupported-mime', nowIso) };
      }
      if (bytes.length > maxBytes) {
        summary.skipped += 1;
        increment(summary.skippedReasons, 'too-large');
        return { changed: true, value: safeSkip(url, 'too-large', nowIso) };
      }
      const saved = await writeArchivedPhoto({
        uploadsRoot: root,
        collection: context.collection,
        recordId: context.recordId,
        originalUrl: url,
        mimeType,
        bytes,
        nowIso,
      });
      if (!saved.ok) {
        summary.skipped += 1;
        increment(summary.skippedReasons, saved.code || 'skipped');
        return { changed: true, value: safeSkip(url, saved.code || 'skipped', nowIso) };
      }
      summary.archived += 1;
      return { changed: true, value: saved.metadata };
    } catch (error) {
      const code = error?.code || error?.message || 'download-failed';
      if (code === 'non-image-content' || code === 'too-large' || code === 'unsupported-mime') {
        summary.skipped += 1;
        increment(summary.skippedReasons, code);
        return { changed: true, value: safeSkip(url, code, nowIso) };
      }
      summary.failed += 1;
      increment(summary.failedReasons, String(code).slice(0, 80));
      return { changed: true, value: safeFailure(url, String(code).slice(0, 80), nowIso) };
    }
  }

  async function visit(value, context) {
    if (typeof value === 'string') {
      if (!context.inPhotoField || !externalUrl(value)) return { changed: false, value };
      return archiveUrl(value, context);
    }

    if (Array.isArray(value)) {
      let changed = false;
      const next = [];
      for (let index = 0; index < value.length; index += 1) {
        const result = await visit(value[index], { ...context, index });
        changed = changed || result.changed;
        next.push(result.value);
      }
      return { changed, value: changed ? next : value };
    }

    if (isPlainObject(value)) {
      if (typeof value.localPath === 'string' && value.localPath.trim()) {
        summary.alreadyArchived += 1;
      }
      if (typeof value.originalUrl === 'string' && externalUrl(value.originalUrl)) {
        if (value.localPath) return { changed: false, value };
        if (context.inPhotoField) {
          const result = await archiveUrl(value.originalUrl, context);
          return {
            changed: result.changed,
            value: result.changed ? { ...value, ...result.value } : value,
          };
        }
      }

      let changed = false;
      const next = { ...value };
      for (const [key, nested] of Object.entries(value)) {
        const inPhotoField = context.inPhotoField || shouldInspectField(key);
        if (inPhotoField) countStorage(summary, context.collection, key, nested);
        if (inPhotoField || (nested && typeof nested === 'object')) {
          const result = await visit(nested, {
            ...context,
            fieldName: key,
            inPhotoField,
          });
          if (result.changed) {
            changed = true;
            next[key] = result.value;
          }
        }
      }
      return { changed, value: changed ? next : value };
    }

    return { changed: false, value };
  }

  for (const collection of collections || []) {
    const data = readData(collection);
    const records = Array.isArray(data) ? data : [];
    let collectionChanged = false;
    const nextRecords = [];
    for (let index = 0; index < records.length; index += 1) {
      const result = await visit(records[index], {
        collection,
        recordId: recordId(records[index], index),
        fieldName: 'record',
        inPhotoField: false,
        index,
      });
      collectionChanged = collectionChanged || result.changed;
      nextRecords.push(result.value);
    }
    if (collectionChanged) changedCollections.set(collection, nextRecords);
  }

  if (!dryRun) {
    for (const [collection, nextRecords] of changedCollections.entries()) {
      writeData(collection, nextRecords);
    }
  }

  return {
    ok: true,
    dryRun,
    allowDomains: [...allowed],
    uploadsRoot: path.basename(root),
    changedCollections: [...changedCollections.keys()],
    summary,
  };
}

module.exports = {
  DEFAULT_ALLOWED_DOMAINS,
  DEFAULT_MAX_BYTES,
  archiveExternalPhotos,
  extensionForMime,
};
