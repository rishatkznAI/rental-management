const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { validatePublicSiteCms } = require('../lib/public-site-cms');

const COLLECTION = 'public_site_cms';
const IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function cleanStoredCms(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    content: value.content && typeof value.content === 'object' ? value.content : null,
    equipment: Array.isArray(value.equipment) ? value.equipment : null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
  };
}

function decodeImage(body) {
  const contentType = String(body?.contentType || '').toLowerCase();
  const extension = IMAGE_TYPES.get(contentType);
  if (!extension) return { error: 'Поддерживаются JPG, PNG, WebP и AVIF' };
  const encoded = String(body?.base64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!encoded) return { error: 'Файл изображения пуст' };
  let buffer;
  try {
    buffer = Buffer.from(encoded, 'base64');
  } catch {
    return { error: 'Не удалось прочитать изображение' };
  }
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return { error: 'Изображение должно быть не больше 8 МБ' };
  return { buffer, extension, contentType };
}

function registerPublicSiteRoutes(deps) {
  const {
    readData,
    writeData,
    requireAuth,
    requireAdmin,
    auditLog,
    uploadRoot,
    nowIso = () => new Date().toISOString(),
  } = deps;
  const router = express.Router();
  const mediaRoot = path.join(uploadRoot, 'public-site');

  router.get('/public-site/cms', (_req, res) => {
    const value = cleanStoredCms(readData(COLLECTION));
    res.set('Cache-Control', 'no-store');
    return res.json(value || { content: null, equipment: null, updatedAt: null });
  });

  router.put('/public-site/cms', requireAuth, requireAdmin, (req, res) => {
    const result = validatePublicSiteCms(req.body);
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    const previous = cleanStoredCms(readData(COLLECTION));
    const next = {
      content: req.body.content,
      equipment: req.body.equipment,
      updatedAt: nowIso(),
      updatedBy: req.user?.email || req.user?.userName || req.user?.userId || 'admin',
    };
    writeData(COLLECTION, next);
    auditLog?.(req, {
      action: 'public_site.content.update',
      entityType: COLLECTION,
      entityId: 'site',
      before: previous ? { updatedAt: previous.updatedAt, equipmentCount: previous.equipment?.length || 0 } : null,
      after: { updatedAt: next.updatedAt, equipmentCount: next.equipment.length },
    });
    return res.json({ ok: true, updatedAt: next.updatedAt });
  });

  router.post('/public-site/media', requireAuth, requireAdmin, (req, res) => {
    const decoded = decodeImage(req.body);
    if (decoded.error) return res.status(400).json({ ok: false, error: decoded.error });
    fs.mkdirSync(mediaRoot, { recursive: true });
    const fileName = `site-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${decoded.extension}`;
    fs.writeFileSync(path.join(mediaRoot, fileName), decoded.buffer, { flag: 'wx' });
    const mediaPath = `/api/public-site/media/${encodeURIComponent(fileName)}`;
    auditLog?.(req, {
      action: 'public_site.media.upload',
      entityType: 'public_site_media',
      entityId: fileName,
      after: { contentType: decoded.contentType, bytes: decoded.buffer.length },
    });
    return res.status(201).json({ ok: true, path: mediaPath });
  });

  router.get('/public-site/media/:fileName', (req, res) => {
    const fileName = String(req.params.fileName || '');
    if (!/^site-[0-9]+-[a-f0-9]{12}\.(?:jpg|png|webp|avif)$/.test(fileName)) return res.status(404).end();
    const target = path.join(mediaRoot, fileName);
    if (!fs.existsSync(target)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.sendFile(target);
  });

  return router;
}

module.exports = {
  COLLECTION,
  MAX_IMAGE_BYTES,
  cleanStoredCms,
  decodeImage,
  registerPublicSiteRoutes,
};
