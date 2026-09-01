const crypto = require('crypto');

const MAX_CMS_BYTES = 1_500_000;
const MAX_EQUIPMENT_ITEMS = 100;
const COMPANY_FIELDS = Object.freeze([
  'name', 'descriptor', 'phone', 'phoneHref', 'email', 'hours',
  'whatsapp', 'telegram', 'address', 'legal',
]);
const CONTENT_SECTION_FIELDS = Object.freeze({
  home: Object.freeze([
    'eyebrow', 'title', 'description', 'categoriesTitle',
    'categoriesDescription', 'popularTitle', 'selectionTitle',
    'selectionDescription', 'requestTitle', 'requestDescription',
  ]),
  catalog: Object.freeze([
    'eyebrow', 'title', 'description', 'helperTitle', 'helperDescription',
  ]),
  servicesPage: Object.freeze([
    'eyebrow', 'title', 'description', 'requestTitle', 'requestDescription',
  ]),
  about: Object.freeze([
    'eyebrow', 'title', 'description', 'storyTitle', 'storyText',
  ]),
  contacts: Object.freeze([
    'eyebrow', 'title', 'description', 'mapTitle', 'mapDescription',
  ]),
});
const LIFT_TEXT_FIELDS = Object.freeze([
  'name', 'category', 'categoryShort', 'platformSize', 'engine', 'drive',
  'use', 'surface', 'manufacturer', 'availability', 'image', 'purpose',
]);
const LIFT_NUMBER_FIELDS = Object.freeze([
  'workingHeight', 'platformHeight', 'capacity', 'weight', 'price', 'popularity',
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isText(value, maxLength = 5000) {
  return typeof value === 'string' && value.length <= maxLength;
}

function isTextList(value, maxItems = 50, maxLength = 1000) {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every(item => isText(item, maxLength));
}

function validCompany(company) {
  if (!isObject(company)) return false;
  return COMPANY_FIELDS.every(key => isText(company[key])) && isTextList(company.cities, 30, 200);
}

function validPageSection(section, fields) {
  return isObject(section)
    && fields.every(key => isText(section[key]))
    && Object.values(section).every(value => isText(value));
}

function validSiteContent(content) {
  if (!isObject(content) || !validCompany(content.company)) return false;
  if (!isText(content.demoNotice) || !isText(content.footerText)) return false;
  if (!Object.entries(CONTENT_SECTION_FIELDS).every(([key, fields]) => (
    validPageSection(content[key], fields)
  ))) return false;
  return Array.isArray(content.services)
    && content.services.length <= 30
    && content.services.every(item => isObject(item) && isText(item.title, 500) && isText(item.text));
}

function validLift(lift) {
  if (!isObject(lift)) return false;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(lift.slug || ''))) return false;
  if (!LIFT_TEXT_FIELDS.every(key => isText(lift[key], key === 'purpose' ? 5000 : 1000))) return false;
  if (!LIFT_NUMBER_FIELDS.every(key => Number.isFinite(lift[key]) && lift[key] >= 0)) return false;
  if (!isTextList(lift.gallery, 30, 2000) || !isTextList(lift.limits, 30, 1000) || !isTextList(lift.benefits, 30, 1000)) return false;
  return lift.published === undefined || typeof lift.published === 'boolean';
}

function validatePublicSiteCms(value) {
  if (!isObject(value)) return { ok: false, error: 'Некорректный формат данных сайта' };
  let bytes = 0;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return { ok: false, error: 'Данные сайта не удалось обработать' };
  }
  if (bytes > MAX_CMS_BYTES) return { ok: false, error: 'Данные сайта превышают допустимый размер' };
  if (!validSiteContent(value.content)) return { ok: false, error: 'Проверьте тексты и контакты сайта' };
  if (!Array.isArray(value.equipment) || value.equipment.length > MAX_EQUIPMENT_ITEMS || !value.equipment.every(validLift)) {
    return { ok: false, error: 'Проверьте карточки техники' };
  }
  const slugs = value.equipment.map(item => item.slug);
  if (new Set(slugs).size !== slugs.length) return { ok: false, error: 'Адреса страниц техники не должны повторяться' };
  return { ok: true };
}

function cleanStoredCms(value) {
  if (!isObject(value)) return null;
  return {
    content: isObject(value.content) ? value.content : null,
    equipment: Array.isArray(value.equipment) ? value.equipment : null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
  };
}

function publicSiteCmsVersion(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex');
}

function pickTextFields(source, fields) {
  return Object.fromEntries(fields.map(key => [key, source[key]]));
}

function projectPublicSiteContent(content) {
  return {
    company: {
      ...pickTextFields(content.company, COMPANY_FIELDS),
      cities: [...content.company.cities],
    },
    demoNotice: content.demoNotice,
    footerText: content.footerText,
    ...Object.fromEntries(Object.entries(CONTENT_SECTION_FIELDS).map(([key, fields]) => [
      key,
      pickTextFields(content[key], fields),
    ])),
    services: content.services.map(item => ({ title: item.title, text: item.text })),
  };
}

function projectPublicSiteLift(lift) {
  return {
    slug: lift.slug,
    ...pickTextFields(lift, LIFT_TEXT_FIELDS),
    ...Object.fromEntries(LIFT_NUMBER_FIELDS.map(key => [key, lift[key]])),
    gallery: [...lift.gallery],
    limits: [...lift.limits],
    benefits: [...lift.benefits],
    published: true,
  };
}

function sanitizePublicSiteCms(value) {
  return {
    content: projectPublicSiteContent(value.content),
    equipment: value.equipment.map(lift => ({
      ...projectPublicSiteLift(lift),
      // Legacy records can lack this field. Public visibility is explicit
      // opt-in, so absence defaults to hidden instead of silently publishing.
      published: lift.published === true,
    })),
  };
}

function projectPublishedPublicSiteCms(value) {
  const stored = cleanStoredCms(value);
  if (
    !stored?.content
    || !stored.equipment
    || !validatePublicSiteCms({ content: stored.content, equipment: stored.equipment }).ok
  ) return null;
  const sanitized = sanitizePublicSiteCms(stored);
  return {
    content: sanitized.content,
    equipment: sanitized.equipment
      .filter(item => item.published === true)
      .map(item => ({ ...item, published: true })),
    updatedAt: stored.updatedAt,
  };
}

function normalizeSiteIdentity(value) {
  const identity = String(value ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (
    !identity
    || identity.length > 253
    || identity.includes('..')
    || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(identity)
  ) return '';
  return identity;
}

function mappingRows(value) {
  let parsed = value;
  if (typeof value === 'string') {
    if (!value.trim()) return [];
    try {
      parsed = JSON.parse(value);
    } catch (cause) {
      const error = new Error('PUBLIC_SITE_TENANT_MAP_JSON must contain valid JSON.');
      error.code = 'PUBLIC_SITE_TENANT_MAP_INVALID';
      error.cause = cause;
      throw error;
    }
  }
  if (Array.isArray(parsed)) return parsed;
  if (isObject(parsed)) {
    return Object.entries(parsed).map(([siteIdentity, scope]) => ({
      siteIdentity,
      ...(typeof scope === 'string' ? { companyId: scope, tenantId: scope } : scope),
    }));
  }
  const error = new Error('Public site tenant mapping must be an object or an array.');
  error.code = 'PUBLIC_SITE_TENANT_MAP_INVALID';
  throw error;
}

function createPublicSiteTenantResolver(value) {
  const resolved = new Map();
  const ambiguous = new Set();
  for (const row of mappingRows(value)) {
    const siteIdentity = normalizeSiteIdentity(row?.siteIdentity ?? row?.identity ?? row?.site);
    const companyId = String(row?.companyId ?? row?.tenantId ?? '').trim();
    const tenantId = String(row?.tenantId ?? row?.companyId ?? '').trim();
    if (!siteIdentity || !companyId || companyId !== tenantId) {
      const error = new Error('Each public site identity must map to one exact company-is-tenant scope.');
      error.code = 'PUBLIC_SITE_TENANT_MAP_INVALID';
      throw error;
    }
    const previous = resolved.get(siteIdentity);
    if (previous && (previous.companyId !== companyId || previous.tenantId !== tenantId)) {
      ambiguous.add(siteIdentity);
      resolved.delete(siteIdentity);
      continue;
    }
    if (!ambiguous.has(siteIdentity)) {
      resolved.set(siteIdentity, Object.freeze({ companyId, tenantId }));
    }
  }
  return Object.freeze(function resolvePublicSiteTenant(siteIdentity) {
    const identity = normalizeSiteIdentity(siteIdentity);
    if (!identity || ambiguous.has(identity)) return null;
    return resolved.get(identity) || null;
  });
}

module.exports = {
  COMPANY_FIELDS,
  CONTENT_SECTION_FIELDS,
  LIFT_NUMBER_FIELDS,
  LIFT_TEXT_FIELDS,
  MAX_CMS_BYTES,
  MAX_EQUIPMENT_ITEMS,
  cleanStoredCms,
  createPublicSiteTenantResolver,
  normalizeSiteIdentity,
  projectPublishedPublicSiteCms,
  publicSiteCmsVersion,
  sanitizePublicSiteCms,
  validLift,
  validSiteContent,
  validatePublicSiteCms,
};
