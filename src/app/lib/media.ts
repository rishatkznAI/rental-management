import { API_BASE_URL } from './api';
import {
  isAuthenticatedMediaUrl as isAuthenticatedMediaUrlImpl,
  normalizePhotoList as normalizePhotoListImpl,
  normalizePhotoReference as normalizePhotoReferenceImpl,
} from './media-normalize.js';

export type ArchivedPhotoReference = {
  id?: string;
  originalUrl?: string;
  localPath?: string;
  filename?: string;
  fileName?: string;
  url?: string;
  src?: string;
  path?: string;
  href?: string;
  fileUrl?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  dataUrl?: string;
  base64?: string;
  attachmentUrl?: string;
  file?: { url?: string; path?: string };
  attachment?: { url?: string };
  mimeType?: string;
  size?: number;
  archivedAt?: string;
  archiveStatus?: 'archived' | 'failed' | 'skipped';
  archiveErrorCode?: string;
};

export type PhotoReference = string | ArchivedPhotoReference;

export type NormalizedPhoto = {
  id: string;
  url: string | null;
  thumbnailUrl: string | null;
  fullUrl: string | null;
  filename?: string;
  source?: string;
  isBroken?: boolean;
  unavailableReason?: string;
};

export function normalizePhotoReference(
  photo: PhotoReference | null | undefined,
  options: { idPrefix?: string; index?: number } = {},
): NormalizedPhoto {
  return normalizePhotoReferenceImpl(photo, { ...options, apiBaseUrl: API_BASE_URL }) as NormalizedPhoto;
}

export function normalizePhotoList(
  photos: PhotoReference[] | null | undefined,
  options: { idPrefix?: string } = {},
): NormalizedPhoto[] {
  return normalizePhotoListImpl(photos, { ...options, apiBaseUrl: API_BASE_URL }) as NormalizedPhoto[];
}

export function photoSource(photo: PhotoReference | null | undefined): string {
  return normalizePhotoReference(photo).fullUrl || '';
}

export function photoFallbackSource(photo: PhotoReference | null | undefined): string {
  if (!photo || typeof photo === 'string') return '';
  if (photo.localPath) return normalizePhotoReference(photo.originalUrl).fullUrl || '';
  return '';
}

export function absoluteMediaUrl(src: string): string {
  if (!src) return '';
  if (/^https?:\/\//i.test(src) || src.startsWith('data:') || src.startsWith('blob:')) return src;
  return `${API_BASE_URL}${src.startsWith('/') ? src : `/${src}`}`;
}

export function isAuthenticatedMediaUrl(url: string | null | undefined): boolean {
  return isAuthenticatedMediaUrlImpl(url, API_BASE_URL);
}
