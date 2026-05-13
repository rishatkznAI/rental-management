const PHOTO_URL_FIELDS = [
  'url',
  'src',
  'path',
  'href',
  'fileUrl',
  'imageUrl',
  'thumbnailUrl',
  'previewUrl',
  'dataUrl',
  'base64',
  'attachmentUrl',
  'localPath',
  'originalUrl',
];

const BAD_STRING_VALUES = new Set(['', 'null', 'undefined', '[object object]', 'blob:null']);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function isDataImage(value) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value);
}

function isLikelyBase64(value) {
  const compact = value.replace(/\s+/g, '');
  return compact.length >= 32 && compact.length % 4 === 0 && /^[a-z0-9+/]+={0,2}$/i.test(compact);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function isProbablyRelativeMediaPath(value) {
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  if (value.includes('[object Object]')) return false;
  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) return true;
  if (/^(api|uploads|photos|documents|files|attachments)\//i.test(value)) return true;
  return /\.(avif|bmp|gif|heic|heif|jpe?g|png|webp)(\?|#|$)/i.test(value);
}

function resolveMediaUrl(value, apiBaseUrl = '') {
  if (isDataImage(value) || isHttpUrl(value)) return value;
  if (isLikelyBase64(value)) return `data:image/jpeg;base64,${value.replace(/\s+/g, '')}`;
  if (!isProbablyRelativeMediaPath(value)) return null;
  const base = String(apiBaseUrl || '').replace(/\/$/, '');
  const normalizedPath = value.startsWith('/') ? value : `/${value.replace(/^\.\//, '')}`;
  return `${base}${encodeURI(normalizedPath)}`;
}

function filenameFrom(value) {
  const text = cleanText(value);
  if (!text) return undefined;
  const clean = text.split(/[?#]/)[0].split('/').filter(Boolean).pop();
  return clean || undefined;
}

function collectCandidates(photo) {
  if (typeof photo === 'string') return [{ source: 'value', value: photo }];
  const object = asObject(photo);
  if (!object) return [];

  const candidates = [];
  for (const field of PHOTO_URL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(object, field)) {
      candidates.push({ source: field, value: object[field] });
    }
  }
  for (const [parent, child] of [['file', 'url'], ['file', 'path'], ['attachment', 'url']]) {
    const nested = asObject(object[parent]);
    if (nested && Object.prototype.hasOwnProperty.call(nested, child)) {
      candidates.push({ source: `${parent}.${child}`, value: nested[child] });
    }
  }
  return candidates;
}

function reasonForValue(value) {
  if (value == null) return 'Фото недоступно';
  if (typeof value !== 'string') return 'Ссылка повреждена';
  const text = cleanText(value);
  if (BAD_STRING_VALUES.has(text.toLowerCase())) return 'Ссылка повреждена';
  if (/^blob:/i.test(text)) return 'Ссылка из старой сессии недоступна';
  return 'Ссылка повреждена';
}

export function normalizePhotoReference(photo, options = {}) {
  const candidates = collectCandidates(photo);
  const idPrefix = options.idPrefix || 'photo';
  const fallbackId = `${idPrefix}-${options.index ?? 0}`;
  const object = asObject(photo);
  const explicitId = cleanText(object?.id) || cleanText(object?.photoId) || cleanText(object?.attachmentId);

  for (const candidate of candidates) {
    const raw = cleanText(candidate.value);
    if (!raw || BAD_STRING_VALUES.has(raw.toLowerCase()) || /^blob:/i.test(raw)) continue;
    const fullUrl = resolveMediaUrl(raw, options.apiBaseUrl);
    if (!fullUrl) continue;
    const thumbnailCandidate = candidates.find(item => ['thumbnailUrl', 'previewUrl'].includes(item.source));
    const thumbnailRaw = cleanText(thumbnailCandidate?.value);
    const thumbnailUrl = thumbnailRaw ? resolveMediaUrl(thumbnailRaw, options.apiBaseUrl) || fullUrl : fullUrl;
    return {
      id: explicitId || `${fallbackId}-${candidate.source}`,
      url: fullUrl,
      thumbnailUrl,
      fullUrl,
      filename: cleanText(object?.filename) || cleanText(object?.fileName) || filenameFrom(raw),
      source: candidate.source,
      isBroken: false,
    };
  }

  const firstValue = candidates.length ? candidates[0].value : photo;
  return {
    id: explicitId || fallbackId,
    url: null,
    thumbnailUrl: null,
    fullUrl: null,
    filename: cleanText(object?.filename) || cleanText(object?.fileName) || undefined,
    source: candidates[0]?.source,
    isBroken: true,
    unavailableReason: reasonForValue(firstValue),
  };
}

export function normalizePhotoList(photos, options = {}) {
  if (!Array.isArray(photos)) return [];
  return photos.map((photo, index) => normalizePhotoReference(photo, { ...options, index }));
}

export function isAuthenticatedMediaUrl(url, apiBaseUrl = '') {
  const text = cleanText(url);
  if (!text || isDataImage(text) || /^blob:/i.test(text)) return false;
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(text, base);
    const apiBase = cleanText(apiBaseUrl);
    const sameApiOrigin = apiBase ? parsed.href.startsWith(`${apiBase.replace(/\/$/, '')}/`) : parsed.origin === new URL(base).origin;
    return sameApiOrigin && (/^\/api\//.test(parsed.pathname) || /^\/uploads\//.test(parsed.pathname));
  } catch {
    return false;
  }
}
