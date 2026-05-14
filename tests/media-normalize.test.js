import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  isAuthenticatedMediaUrl,
  normalizePhotoList,
  normalizePhotoReference,
} from '../src/app/lib/media-normalize.js';

test('normalizes legacy photo URL shapes to stable media URLs', () => {
  const cases = [
    [{ url: '/uploads/a.jpg' }, '/api-base/uploads/a.jpg', 'url'],
    [{ src: 'uploads/b.jpg' }, '/api-base/uploads/b.jpg', 'src'],
    [{ path: 'photos/c.png' }, '/api-base/photos/c.png', 'path'],
    [{ href: 'https://cdn.example.test/d.jpg' }, 'https://cdn.example.test/d.jpg', 'href'],
    [{ fileUrl: '/files/e.webp' }, '/api-base/files/e.webp', 'fileUrl'],
    [{ imageUrl: '/uploads/f.jpg' }, '/api-base/uploads/f.jpg', 'imageUrl'],
    [{ thumbnailUrl: '/uploads/thumb.jpg', url: '/uploads/full.jpg' }, '/api-base/uploads/full.jpg', 'url'],
    [{ previewUrl: '/uploads/preview.jpg' }, '/api-base/uploads/preview.jpg', 'previewUrl'],
    [{ dataUrl: 'data:image/png;base64,aaaa' }, 'data:image/png;base64,aaaa', 'dataUrl'],
    [{ attachmentUrl: '/attachments/g.jpg' }, '/api-base/attachments/g.jpg', 'attachmentUrl'],
    [{ file: { url: '/uploads/h.jpg' } }, '/api-base/uploads/h.jpg', 'file.url'],
    [{ file: { path: '/uploads/i.jpg' } }, '/api-base/uploads/i.jpg', 'file.path'],
    [{ attachment: { url: '/uploads/j.jpg' } }, '/api-base/uploads/j.jpg', 'attachment.url'],
  ];

  for (const [input, expectedUrl, expectedSource] of cases) {
    const normalized = normalizePhotoReference(input, { apiBaseUrl: '/api-base', idPrefix: 'case' });
    assert.equal(normalized.fullUrl, expectedUrl);
    assert.equal(normalized.url, expectedUrl);
    assert.equal(normalized.source, expectedSource);
    assert.equal(normalized.isBroken, false);
  }
});

test('normalizes data image and raw base64 without touching production records', () => {
  const dataUrl = normalizePhotoReference('data:image/jpeg;base64,abcd', { apiBaseUrl: '' });
  assert.equal(dataUrl.fullUrl, 'data:image/jpeg;base64,abcd');

  const rawBase64 = normalizePhotoReference('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo12345', { apiBaseUrl: '' });
  assert.equal(rawBase64.fullUrl, 'data:image/jpeg;base64,YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo12345');
});

test('keeps legacy delivery and shipping photo arrays visible even with mixed object formats', () => {
  const legacyPhotos = normalizePhotoList([
    { photoId: 'p1', file: { url: '/uploads/from-file.jpg' }, filename: 'from-file.jpg' },
    { attachment: { url: '/uploads/from-attachment.jpg' } },
    { previewUrl: '/uploads/preview.jpg', imageUrl: '/uploads/image.jpg' },
  ], { apiBaseUrl: '', idPrefix: 'delivery' });

  assert.deepEqual(legacyPhotos.map(photo => photo.fullUrl), [
    '/uploads/from-file.jpg',
    '/uploads/from-attachment.jpg',
    '/uploads/image.jpg',
  ]);
  assert.equal(legacyPhotos[0].id, 'p1');
  assert.equal(legacyPhotos[0].filename, 'from-file.jpg');
  assert.equal(legacyPhotos[2].thumbnailUrl, '/uploads/preview.jpg');
});

test('marks empty, stale blob and corrupted values as unavailable', () => {
  for (const value of ['', null, undefined, 'blob:https://old-session/1', '[object Object]', { url: '[object Object]' }]) {
    const normalized = normalizePhotoReference(value, { apiBaseUrl: '' });
    assert.equal(normalized.url, null);
    assert.equal(normalized.thumbnailUrl, null);
    assert.equal(normalized.fullUrl, null);
    assert.equal(normalized.isBroken, true);
    assert.ok(normalized.unavailableReason);
  }
});

test('detects protected media endpoints that need bearer fetch instead of img src', () => {
  assert.equal(isAuthenticatedMediaUrl('/api/files/photo.jpg', ''), true);
  assert.equal(isAuthenticatedMediaUrl('/uploads/photo.jpg', ''), true);
  assert.equal(isAuthenticatedMediaUrl('https://api.example.test/uploads/photo.jpg', 'https://api.example.test'), true);
  assert.equal(isAuthenticatedMediaUrl('https://api.example.test/api/files/photo.jpg', 'https://api.example.test'), true);
  assert.equal(isAuthenticatedMediaUrl('https://other.example.test/uploads/photo.jpg', 'https://api.example.test'), false);
  assert.equal(isAuthenticatedMediaUrl('https://cdn.example.test/photo.jpg', ''), false);
  assert.equal(isAuthenticatedMediaUrl('data:image/jpeg;base64,abcd', ''), false);
});

test('authenticated image handles 401 403 404 fallbacks and only opens loaded photos', () => {
  const source = fs.readFileSync('src/app/components/ui/AuthenticatedImage.tsx', 'utf8');
  assert.match(source, /status === 401 \|\| status === 403/);
  assert.match(source, /status === 404/);
  assert.match(source, /Ответ не является изображением/);
  assert.match(source, /if \(!visibleUrl \|\| failed\)/);
  assert.match(source, /if \(canOpen && onOpen\) onOpen\(visibleUrl\)/);
});

test('head role keeps read-only access to shipping photos without write access', () => {
  const serverSource = fs.readFileSync('server/server.js', 'utf8');
  const equipmentDetailSource = fs.readFileSync('src/app/pages/EquipmentDetail.tsx', 'utf8');
  assert.match(serverSource, /READ_PERMISSIONS[\s\S]*shipping_photos:\['Администратор', 'Менеджер по аренде', 'Офис-менеджер', HEAD_ROLE/);
  assert.match(serverSource, /WRITE_PERMISSIONS[\s\S]*shipping_photos:\['Администратор', \.\.\.MECHANIC_ROLES, 'Менеджер по аренде'\]/);
  assert.match(equipmentDetailSource, /'Руководитель'\]\.includes\(normalizedRole\)/);
});
