function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function equipmentPhotoIdentity(photo) {
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

export function isSameEquipmentPhoto(left, right) {
  const leftIdentity = equipmentPhotoIdentity(left);
  const rightIdentity = equipmentPhotoIdentity(right);
  return Boolean(leftIdentity && rightIdentity && leftIdentity === rightIdentity);
}

export function getEquipmentPhotoGallery(equipment = {}) {
  const storedPhotos = Array.isArray(equipment.photos)
    ? equipment.photos.filter(photo => Boolean(equipmentPhotoIdentity(photo)))
    : [];
  if (!equipmentPhotoIdentity(equipment.photo)) return storedPhotos;
  if (storedPhotos.some(photo => isSameEquipmentPhoto(photo, equipment.photo))) return storedPhotos;
  return [equipment.photo, ...storedPhotos];
}

export function uniqueEquipmentPhotos(photos = []) {
  const seen = new Set();
  return photos.filter(photo => {
    const identity = equipmentPhotoIdentity(photo);
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
