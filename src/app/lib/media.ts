import { API_BASE_URL } from './api';

export type ArchivedPhotoReference = {
  originalUrl?: string;
  localPath?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  archivedAt?: string;
  archiveStatus?: 'archived' | 'failed' | 'skipped';
  archiveErrorCode?: string;
};

export type PhotoReference = string | ArchivedPhotoReference;

export function photoSource(photo: PhotoReference | null | undefined): string {
  if (!photo) return '';
  if (typeof photo === 'string') return photo;
  return photo.localPath || photo.originalUrl || '';
}

export function photoFallbackSource(photo: PhotoReference | null | undefined): string {
  if (!photo || typeof photo === 'string') return '';
  return photo.localPath ? photo.originalUrl || '' : '';
}

export function absoluteMediaUrl(src: string): string {
  if (!src) return '';
  if (/^https?:\/\//i.test(src) || src.startsWith('data:') || src.startsWith('blob:')) return src;
  return `${API_BASE_URL}${src.startsWith('/') ? src : `/${src}`}`;
}
