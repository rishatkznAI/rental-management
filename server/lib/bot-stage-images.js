const path = require('path');

const BOT_BRAND_IMAGE = path.join(__dirname, '..', 'assets', 'bot', 'brand', 'skytech-logo.png');
const STAGE_IMAGE_DIR = path.join(__dirname, '..', 'assets', 'bot', 'mechanic-stages');

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

function stageImageAttachment(stageKey) {
  const fileName = MECHANIC_STAGE_IMAGES[stageKey];
  if (!fileName) return null;
  return {
    type: 'image',
    payload: {
      file: path.join(STAGE_IMAGE_DIR, fileName),
      cacheKey: `mechanic-stage:${stageKey}`,
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
  MECHANIC_STAGE_IMAGES,
  attachBotBrandImage,
  attachMechanicStageImage,
  brandImageAttachment,
  operationStageImageKey,
  stageImageAttachment,
};
