const path = require('path');

const BOT_BRAND_IMAGE = path.join(__dirname, '..', 'assets', 'bot', 'brand', 'skytech-logo.png');
const BOT_ASSET_PUBLIC_PATH = '/bot-assets';
const MECHANIC_STAGE_IMAGE_DIR = path.join(__dirname, '..', 'assets', 'bot', 'mechanic-stages');
const DELIVERY_STAGE_IMAGE_DIR = path.join(__dirname, '..', 'assets', 'bot', 'delivery-stages');
const MANAGER_STAGE_IMAGE_DIR = path.join(__dirname, '..', 'assets', 'bot', 'manager-stages');
const BOT_STAGE_IMAGE_VERSION = 'optimistic-manager-2026-04-27';

const MECHANIC_STAGE_IMAGES = {
  main: 'main-menu-optimistic.jpg',
  menu: 'main-menu-optimistic.jpg',
  repairs: 'repair-optimistic.jpg',
  repair: 'repair-optimistic.jpg',
  ticket: 'repair-optimistic.jpg',
  work: 'repair-optimistic.jpg',
  parts: 'parts-optimistic.jpg',
  photo: 'photo-optimistic.jpg',
  field_trip: 'field-trip-optimistic.jpg',
  handoff: 'handoff-optimistic.jpg',
  operation_check: 'handoff-optimistic.jpg',
  operation_photo: 'photo-optimistic.jpg',
  complete: 'complete-optimistic.jpg',
};

const DELIVERY_STAGE_IMAGES = {
  delivery_main: 'main-menu-optimistic.jpg',
  delivery_list: 'delivery-list-optimistic.jpg',
  delivery_status: 'delivery-status-optimistic.jpg',
};

const MANAGER_STAGE_IMAGES = {
  manager_main: 'main-menu-optimistic.jpg',
  manager_rentals: 'rentals-optimistic.jpg',
  manager_equipment: 'equipment-optimistic.jpg',
  manager_summary: 'summary-optimistic.jpg',
  manager_delivery: 'delivery-create-optimistic.jpg',
  manager_service: 'service-create-optimistic.jpg',
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

  if (MANAGER_STAGE_IMAGES[stageKey]) {
    return {
      fileName: MANAGER_STAGE_IMAGES[stageKey],
      dir: MANAGER_STAGE_IMAGE_DIR,
      publicDir: 'manager-stages',
      cachePrefix: 'manager-stage',
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
  const publicPath = `${BOT_ASSET_PUBLIC_PATH}/${config.publicDir}/${config.fileName}`;
  return {
    type: 'image',
    payload: {
      file: path.join(config.dir, config.fileName),
      publicPath,
      cacheKey: `${config.cachePrefix}:${stageKey}:${BOT_STAGE_IMAGE_VERSION}`,
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
  BOT_STAGE_IMAGE_VERSION,
  DELIVERY_STAGE_IMAGES,
  MANAGER_STAGE_IMAGES,
  MECHANIC_STAGE_IMAGES,
  attachBotBrandImage,
  attachMechanicStageImage,
  brandImageAttachment,
  operationStageImageKey,
  stageImageAttachment,
};
