const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  cleanStoredCms,
  normalizeSiteIdentity,
  publicSiteCmsVersion,
  sanitizePublicSiteCms,
  validatePublicSiteCms,
} = require('../lib/public-site-cms');
const { assertCompleteActorScope } = require('../lib/trusted-actor-scope');

const COLLECTION = 'public_site_cms';
const IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MEDIA_FILE_PATTERN = /^site-[0-9]+-[a-f0-9]{12}\.(?:jpg|png|webp|avif)$/;
const MEDIA_NAMESPACE_PATTERN = /^[a-f0-9]{64}$/;

function decodeImage(body) {
  const contentType = String(body?.contentType || '').toLowerCase();
  const extension = IMAGE_TYPES.get(contentType);
  if (!extension) return { error: 'Поддерживаются JPG, PNG, WebP и AVIF' };
  const encoded = String(body?.base64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!encoded) return { error: 'Файл изображения пуст' };
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return { error: 'Не удалось прочитать изображение' };
  }
  let buffer;
  try {
    buffer = Buffer.from(encoded, 'base64');
  } catch {
    return { error: 'Не удалось прочитать изображение' };
  }
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    return { error: 'Изображение должно быть не больше 8 МБ' };
  }
  return { buffer, extension, contentType };
}

function tenantMediaNamespace(scope) {
  const trusted = assertCompleteActorScope(scope);
  return crypto
    .createHash('sha256')
    .update(`rentcore.public-site-media.v1\0${trusted.tenantId}`)
    .digest('hex');
}

function containedPath(root, ...segments) {
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, ...segments);
  if (target === absoluteRoot || !target.startsWith(`${absoluteRoot}${path.sep}`)) {
    const error = new Error('Public-site media path escaped its storage root.');
    error.code = 'PUBLIC_SITE_MEDIA_PATH_INVALID';
    throw error;
  }
  return target;
}

function resolveConfiguredUploadRoot(uploadRoot, { create = false } = {}) {
  const absoluteRoot = path.resolve(uploadRoot);
  if (!fs.existsSync(absoluteRoot)) {
    if (!create) {
      const error = new Error('Public-site upload root does not exist.');
      error.code = 'PUBLIC_SITE_MEDIA_DIRECTORY_INVALID';
      throw error;
    }
    // The database directory is already an existing trusted runtime path. Do
    // not recursively manufacture additional ancestors for a media request.
    fs.mkdirSync(absoluteRoot, { mode: 0o700 });
  }
  const stat = fs.lstatSync(absoluteRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    const error = new Error('Public-site upload root must be a real directory.');
    error.code = 'PUBLIC_SITE_MEDIA_DIRECTORY_INVALID';
    throw error;
  }
  // Continue through the canonical path so a symlinked ancestor cannot make
  // later lexical containment checks point outside the bound storage root.
  return fs.realpathSync(absoluteRoot);
}

function assertCanonicalDirectory(directory) {
  const stat = fs.lstatSync(directory);
  const canonical = fs.realpathSync(directory);
  if (
    !stat.isDirectory()
    || stat.isSymbolicLink()
    || path.resolve(canonical) !== path.resolve(directory)
  ) {
    const error = new Error('Public-site media storage must be a canonical real directory.');
    error.code = 'PUBLIC_SITE_MEDIA_DIRECTORY_INVALID';
    throw error;
  }
  return canonical;
}

function ensureTenantMediaDirectory(canonicalUploadRoot, namespace) {
  if (!MEDIA_NAMESPACE_PATTERN.test(namespace)) {
    const error = new Error('Public-site media namespace is invalid.');
    error.code = 'PUBLIC_SITE_MEDIA_NAMESPACE_INVALID';
    throw error;
  }
  const mediaRoot = containedPath(canonicalUploadRoot, 'public-site');
  if (!fs.existsSync(mediaRoot)) fs.mkdirSync(mediaRoot, { mode: 0o700 });
  assertCanonicalDirectory(mediaRoot);
  const directory = containedPath(mediaRoot, namespace);
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
  assertCanonicalDirectory(directory);
  return { directory, mediaRoot };
}

function requireExactTenantActor(req, res, next) {
  try {
    const scope = assertCompleteActorScope(req.actorScope);
    const principalId = String(scope.principalId || '').trim();
    const userId = String(req.user?.userId || '').trim();
    if (!principalId || principalId !== userId) {
      return res.status(403).json({
        ok: false,
        code: 'CMS_TENANT_MEMBERSHIP_REQUIRED',
        error: 'Active tenant membership is required for CMS administration.',
      });
    }
    return next();
  } catch {
    return res.status(403).json({
      ok: false,
      code: 'CMS_TENANT_MEMBERSHIP_REQUIRED',
      error: 'Active tenant membership is required for CMS administration.',
    });
  }
}

function routeError(res, error) {
  const guardedWriteCodes = new Set([
    'PRODUCTION_SCOPE_WRITE_FREEZE_ACTIVE',
    'PRODUCTION_VALIDATION_READ_ONLY_WRITE_BLOCKED',
  ]);
  const status = Number(error?.status) || (guardedWriteCodes.has(error?.code) ? 503 : 500);
  return res.status(status).json({
    ok: false,
    code: error?.code || 'PUBLIC_SITE_REQUEST_FAILED',
    error: status >= 500 ? 'Public site request failed.' : error.message,
  });
}

function registerPublicSiteRoutes(deps) {
  const {
    readData,
    writeData,
    readPublishedCms,
    requireAuth,
    requireAdmin,
    auditLog,
    assertStorageWriteAllowed,
    uploadRoot,
    nowIso = () => new Date().toISOString(),
  } = deps;
  if (
    typeof readData !== 'function'
    || typeof writeData !== 'function'
    || typeof readPublishedCms !== 'function'
    || typeof requireAuth !== 'function'
    || typeof requireAdmin !== 'function'
    || typeof auditLog !== 'function'
    || typeof assertStorageWriteAllowed !== 'function'
  ) throw new TypeError('Public-site routes require bounded storage, authentication, audit and write guards.');
  if (!String(uploadRoot || '').trim()) throw new TypeError('Public-site routes require an upload root.');

  const router = express.Router();
  const configuredUploadRoot = path.resolve(uploadRoot);

  router.get('/public-site/public/:siteIdentity/cms', (req, res) => {
    const siteIdentity = normalizeSiteIdentity(req.params.siteIdentity);
    if (!siteIdentity) {
      return res.status(404).json({
        ok: false,
        code: 'PUBLIC_SITE_IDENTITY_UNRESOLVED',
        error: 'Public site identity was not found.',
      });
    }
    try {
      const value = readPublishedCms(siteIdentity);
      if (!value) {
        return res.status(404).json({
          ok: false,
          code: 'PUBLIC_SITE_CMS_NOT_PUBLISHED',
          error: 'Published public site content was not found.',
        });
      }
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return res.json(value);
    } catch (error) {
      return routeError(res, error);
    }
  });

  router.get('/public-site/cms', requireAuth, requireAdmin, requireExactTenantActor, (req, res) => {
    try {
      const stored = readData(COLLECTION);
      const value = cleanStoredCms(stored);
      res.set('Cache-Control', 'no-store');
      return res.json({
        ...(value || { content: null, equipment: null, updatedAt: null }),
        version: publicSiteCmsVersion(stored),
      });
    } catch (error) {
      return routeError(res, error);
    }
  });

  router.put('/public-site/cms', requireAuth, requireAdmin, requireExactTenantActor, (req, res) => {
    const result = validatePublicSiteCms(req.body);
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    const expectedVersion = String(req.body?.expectedVersion || '').trim();
    if (!/^[a-f0-9]{64}$/.test(expectedVersion)) {
      return res.status(400).json({
        ok: false,
        code: 'PUBLIC_SITE_CMS_VERSION_REQUIRED',
        error: 'A valid CMS version is required before saving.',
      });
    }
    try {
      const current = readData(COLLECTION);
      if (publicSiteCmsVersion(current) !== expectedVersion) {
        return res.status(409).json({
          ok: false,
          code: 'PUBLIC_SITE_CMS_VERSION_CONFLICT',
          error: 'Public site content changed after it was loaded. Reload before saving.',
        });
      }
      const sanitized = sanitizePublicSiteCms(req.body);
      const next = {
        content: sanitized.content,
        equipment: sanitized.equipment,
        updatedAt: nowIso(),
        updatedBy: req.actorScope.principalId,
      };
      writeData(COLLECTION, next);
      return res.json({
        ok: true,
        updatedAt: next.updatedAt,
        version: publicSiteCmsVersion(next),
      });
    } catch (error) {
      return routeError(res, error);
    }
  });

  router.post('/public-site/media', requireAuth, requireAdmin, requireExactTenantActor, (req, res) => {
    const decoded = decodeImage(req.body);
    if (decoded.error) return res.status(400).json({ ok: false, error: decoded.error });
    let target = null;
    let fileCreated = false;
    let directory = null;
    let mediaRoot = null;
    let removeDirectoryOnFailure = false;
    let removeMediaRootOnFailure = false;
    try {
      assertStorageWriteAllowed('public-site tenant media write');
      const namespace = tenantMediaNamespace(req.actorScope);
      const canonicalUploadRoot = resolveConfiguredUploadRoot(configuredUploadRoot, { create: true });
      mediaRoot = containedPath(canonicalUploadRoot, 'public-site');
      removeMediaRootOnFailure = !fs.existsSync(mediaRoot);
      directory = containedPath(mediaRoot, namespace);
      removeDirectoryOnFailure = !fs.existsSync(directory);
      ({ directory, mediaRoot } = ensureTenantMediaDirectory(canonicalUploadRoot, namespace));
      const fileName = `site-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${decoded.extension}`;
      target = containedPath(directory, fileName);
      const descriptor = fs.openSync(target, 'wx', 0o600);
      fileCreated = true;
      try {
        fs.writeFileSync(descriptor, decoded.buffer);
      } finally {
        fs.closeSync(descriptor);
      }
      auditLog(req, {
        action: 'public_site.media.upload',
        entityType: 'public_site_media',
        entityId: fileName,
        after: {
          tenantNamespace: namespace,
          contentType: decoded.contentType,
          bytes: decoded.buffer.length,
        },
      });
      const mediaPath = `/api/public-site/media/${namespace}/${encodeURIComponent(fileName)}`;
      return res.status(201).json({ ok: true, path: mediaPath });
    } catch (error) {
      if (fileCreated && target) {
        try {
          fs.unlinkSync(target);
        } catch {
          // Best-effort rollback after an audit/storage failure; never mask the
          // authoritative error returned to the caller.
        }
      }
      if (removeDirectoryOnFailure && directory) {
        try {
          fs.rmdirSync(directory);
        } catch {
          // Preserve any pre-existing or concurrently written tenant media.
        }
      }
      if (removeMediaRootOnFailure && mediaRoot) {
        try {
          fs.rmdirSync(mediaRoot);
        } catch {
          // Preserve any pre-existing or concurrently written tenant media.
        }
      }
      return routeError(res, error);
    }
  });

  router.get('/public-site/media/:tenantNamespace/:fileName', (req, res) => {
    const namespace = String(req.params.tenantNamespace || '');
    const fileName = String(req.params.fileName || '');
    if (!MEDIA_NAMESPACE_PATTERN.test(namespace) || !MEDIA_FILE_PATTERN.test(fileName)) {
      return res.status(404).end();
    }
    try {
      const canonicalUploadRoot = resolveConfiguredUploadRoot(configuredUploadRoot);
      const mediaRoot = containedPath(canonicalUploadRoot, 'public-site');
      assertCanonicalDirectory(mediaRoot);
      const directory = containedPath(mediaRoot, namespace);
      const target = containedPath(directory, fileName);
      assertCanonicalDirectory(directory);
      const fileStat = fs.lstatSync(target);
      if (
        !fileStat.isFile()
        || fileStat.isSymbolicLink()
        || path.resolve(fs.realpathSync(target)) !== path.resolve(target)
      ) return res.status(404).end();
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      res.set('X-Content-Type-Options', 'nosniff');
      return res.sendFile(target);
    } catch {
      return res.status(404).end();
    }
  });

  return router;
}

module.exports = {
  COLLECTION,
  MAX_IMAGE_BYTES,
  MEDIA_FILE_PATTERN,
  MEDIA_NAMESPACE_PATTERN,
  containedPath,
  decodeImage,
  registerPublicSiteRoutes,
  requireExactTenantActor,
  tenantMediaNamespace,
};
