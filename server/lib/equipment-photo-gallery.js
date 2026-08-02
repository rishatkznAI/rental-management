const MAX_EQUIPMENT_PHOTOS = 50;
const IMAGE_DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i;

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function photoIdentity(photo) {
  if (typeof photo === 'string') return cleanText(photo);
  if (!photo || typeof photo !== 'object' || Array.isArray(photo)) return '';
  return cleanText(photo.id)
    || cleanText(photo.dataUrl)
    || cleanText(photo.localPath)
    || cleanText(photo.url)
    || cleanText(photo.src)
    || cleanText(photo.path)
    || cleanText(photo.imageUrl)
    || cleanText(photo.fileUrl)
    || cleanText(photo.originalUrl);
}

function isUsablePhoto(photo) {
  return Boolean(photoIdentity(photo));
}

function samePhoto(left, right) {
  const leftIdentity = photoIdentity(left);
  const rightIdentity = photoIdentity(right);
  return Boolean(leftIdentity && rightIdentity && leftIdentity === rightIdentity);
}

function equipmentPhotoGallery(equipment = {}) {
  const gallery = Array.isArray(equipment.photos)
    ? equipment.photos.filter(isUsablePhoto)
    : [];
  const mainPhoto = isUsablePhoto(equipment.photo) ? equipment.photo : null;
  if (!mainPhoto || gallery.some(photo => samePhoto(photo, mainPhoto))) return gallery;
  return [mainPhoto, ...gallery];
}

function validateUploadedPhoto(value) {
  if (typeof value !== 'string' || !IMAGE_DATA_URL_PATTERN.test(value.trim())) {
    const error = new Error('Ожидается изображение в формате data URL.');
    error.status = 400;
    error.code = 'EQUIPMENT_PHOTO_INVALID';
    throw error;
  }
  return value.trim();
}

function createUploadedPhoto(input = {}, options = {}) {
  const dataUrl = validateUploadedPhoto(input.photo);
  const id = cleanText(options.id);
  if (!id) throw new Error('Photo id is required.');
  const mimeMatch = dataUrl.match(/^data:([^;,]+)[;,]/i);
  return {
    id,
    dataUrl,
    ...(cleanText(input.filename) ? { filename: cleanText(input.filename) } : {}),
    mimeType: mimeMatch?.[1] || cleanText(input.mimeType) || 'image/jpeg',
    uploadedAt: cleanText(options.uploadedAt),
    ...(cleanText(options.uploadedBy) ? { uploadedBy: cleanText(options.uploadedBy) } : {}),
  };
}

function appendEquipmentPhoto(equipment, photo) {
  if (!isUsablePhoto(photo)) {
    const error = new Error('Фотография не содержит доступного изображения.');
    error.status = 400;
    error.code = 'EQUIPMENT_PHOTO_INVALID';
    throw error;
  }
  const existingPhotos = equipmentPhotoGallery(equipment);
  if (existingPhotos.length >= MAX_EQUIPMENT_PHOTOS) {
    const error = new Error(`Можно сохранить не более ${MAX_EQUIPMENT_PHOTOS} фотографий техники.`);
    error.status = 400;
    error.code = 'EQUIPMENT_PHOTO_LIMIT';
    throw error;
  }
  const photos = [...existingPhotos, photo];
  const next = {
    ...equipment,
    photos,
  };
  if (isUsablePhoto(equipment.photo)) {
    next.photo = equipment.photo;
  } else if (existingPhotos.length === 0) {
    // Only the first-ever upload initializes the main photo. If a main photo was
    // explicitly deleted while gallery items remain, later uploads keep it empty.
    next.photo = photo;
  } else {
    delete next.photo;
  }
  return next;
}

function photoAt(equipment, photoIndex) {
  const index = Number(photoIndex);
  const photos = equipmentPhotoGallery(equipment);
  if (!Number.isInteger(index) || index < 0 || index >= photos.length) {
    const error = new Error('Фотография не найдена в галерее.');
    error.status = 404;
    error.code = 'EQUIPMENT_PHOTO_NOT_FOUND';
    throw error;
  }
  return { photos, index, photo: photos[index] };
}

function makeEquipmentPhotoMain(equipment, photoIndex) {
  const selected = photoAt(equipment, photoIndex);
  return {
    ...equipment,
    photos: selected.photos,
    photo: selected.photo,
  };
}

function deleteEquipmentPhoto(equipment, photoIndex) {
  const selected = photoAt(equipment, photoIndex);
  const photos = selected.photos.filter((_, index) => index !== selected.index);
  const removedMain = samePhoto(equipment.photo, selected.photo);
  const next = {
    ...equipment,
    photos,
  };
  if (removedMain) delete next.photo;
  return next;
}

module.exports = {
  MAX_EQUIPMENT_PHOTOS,
  appendEquipmentPhoto,
  createUploadedPhoto,
  deleteEquipmentPhoto,
  equipmentPhotoGallery,
  makeEquipmentPhotoMain,
  photoIdentity,
  samePhoto,
  validateUploadedPhoto,
};
