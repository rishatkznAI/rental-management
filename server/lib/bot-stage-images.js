const path = require('path');

const BOT_BRAND_IMAGE = path.join(__dirname, '..', 'assets', 'bot', 'brand', 'skytech-logo.png');
const BOT_ASSET_PUBLIC_PATH = '/bot-assets';
const MECHANIC_STAGE_IMAGE_DIR = path.join(__dirname, '..', 'assets', 'bot', 'mechanic-stages');
const DELIVERY_STAGE_IMAGE_DIR = path.join(__dirname, '..', 'assets', 'bot', 'delivery-stages');

const MECHANIC_STAGE_IMAGES = {
  main: 'main-menu.jpg',
  menu: 'main-menu.jpg',
  repairs: 'repair.jpg',
  repair: 'repair.jpg',
  ticket: 'repair.jpg',
  work: 'repair.jpg',
  parts: 'parts.jpg',
  photo: 'photo.jpg',
  field_trip: 'field-trip.jpg',
  handoff: 'handoff.jpg',
  operation_check: 'handoff.jpg',
  operation_photo: 'photo.jpg',
  complete: 'complete.jpg',
};

const DELIVERY_STAGE_IMAGES = {
  delivery_main: 'main-menu.jpg',
  delivery_list: 'delivery-list.jpg',
  delivery_status: 'delivery-status.jpg',
};

function stageImageConfig(stageKey) {
  if (DELIVERY_STAGE_IMAGES[stageKey]) {
    return {
      fileName: DELIVERY_STAGE_IMAGES[stageKey],
      dir: DELIVERY_STAGE_IMAGE_DIR,
      publicDir: 'delivery-stages',
      cachePrefix: 'delivery-stage',
    };
  }

  const fileName = MECHANIC_STAGE_IMAGES[stageKey];
  if (!fileName) return null;
  return {
    fileName,
    dir: MECHANIC_STAGE_IMAGE_DIR,
    publicDir: 'mechanic-stages',
    cachePrefix: 'mechanic-stage',
  };
}

function stageImageAttachment(stageKey) {
  const config = stageImageConfig(stageKey);
  if (!config) return null;
  return {
    type: 'image',
    payload: {
      file: path.join(config.dir, config.fileName),
      publicPath: `${BOT_ASSET_PUBLIC_PATH}/${config.publicDir}/${config.fileName}`,
      cacheKey: `${config.cachePrefix}:${stageKey}`,
    },
  };
}

function normalizeAttachments(attachments) {
  if (!attachments) return [];
  return Array.isArray(attachments) ? attachments : [attachments];
}

function brandImageAttachment() {
  return {
    type: 'image',
    payload: {
      file: BOT_BRAND_IMAGE,
      publicPath: `${BOT_ASSET_PUBLIC_PATH}/brand/skytech-logo.png`,
      cacheKey: 'brand:skytech-logo',
    },
  };
}

function attachBotBrandImage(attachments) {
  return [brandImageAttachment(), ...normalizeAttachments(attachments)];
}

function attachMechanicStageImage(stageKey, attachments) {
  const imageAttachment = stageImageAttachment(stageKey);
  const normalized = normalizeAttachments(attachments);
  if (!imageAttachment) return normalized;
  return [imageAttachment, ...normalized];
}

function operationStageImageKey(stepMeta) {
  if (!stepMeta) return 'handoff';
  if (stepMeta.kind === 'photo') return 'operation_photo';
  return 'operation_check';
}

module.exports = {
  DELIVERY_STAGE_IMAGES,
  MECHANIC_STAGE_IMAGES,
  attachBotBrandImage,
  attachMechanicStageImage,
  brandImageAttachment,
  operationStageImageKey,
  stageImageAttachment,
};
