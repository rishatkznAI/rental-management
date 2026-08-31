const MAX_CMS_BYTES = 1_500_000;
const MAX_EQUIPMENT_ITEMS = 100;

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
  const textFields = ['name', 'descriptor', 'phone', 'phoneHref', 'email', 'hours', 'whatsapp', 'telegram', 'address', 'legal'];
  return textFields.every(key => isText(company[key])) && isTextList(company.cities, 30, 200);
}

function validPageSection(section) {
  return isObject(section)
    && Object.values(section).every(value => isText(value));
}

function validSiteContent(content) {
  if (!isObject(content) || !validCompany(content.company)) return false;
  if (!isText(content.demoNotice) || !isText(content.footerText)) return false;
  if (!['home', 'catalog', 'servicesPage', 'about', 'contacts'].every(key => validPageSection(content[key]))) return false;
  return Array.isArray(content.services)
    && content.services.length <= 30
    && content.services.every(item => isObject(item) && isText(item.title, 500) && isText(item.text));
}

function validLift(lift) {
  if (!isObject(lift)) return false;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(lift.slug || ''))) return false;
  const textFields = ['name', 'category', 'categoryShort', 'platformSize', 'engine', 'drive', 'use', 'surface', 'manufacturer', 'availability', 'image', 'purpose'];
  const numberFields = ['workingHeight', 'platformHeight', 'capacity', 'weight', 'price', 'popularity'];
  if (!textFields.every(key => isText(lift[key], key === 'purpose' ? 5000 : 1000))) return false;
  if (!numberFields.every(key => Number.isFinite(lift[key]) && lift[key] >= 0)) return false;
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

module.exports = {
  MAX_CMS_BYTES,
  MAX_EQUIPMENT_ITEMS,
  validLift,
  validSiteContent,
  validatePublicSiteCms,
};
