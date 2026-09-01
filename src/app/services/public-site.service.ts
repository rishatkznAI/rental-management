import { api, API_BASE_URL } from '../lib/api';
import type { PublicSiteCms, PublicSiteContent, PublicSiteLift } from '../types/public-site';

export const PUBLIC_SITE_URL = ((import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined) || '').replace(/\/$/, '');

export const publicSiteService = {
  async get(): Promise<PublicSiteCms> {
    return api.get<PublicSiteCms>('/api/public-site/cms');
  },

  save: (
    content: PublicSiteContent,
    equipment: PublicSiteLift[],
    expectedVersion: string,
  ): Promise<{ ok: true; updatedAt: string; version: string }> =>
    api.put('/api/public-site/cms', { content, equipment, expectedVersion }),

  uploadImage: (file: File): Promise<{ ok: true; url: string }> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    reader.onload = async () => {
      try {
        const dataUrl = String(reader.result || '');
        const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
        const result = await api.post<{ ok: true; path: string }>('/api/public-site/media', {
          fileName: file.name,
          contentType: file.type,
          base64,
        });
        const apiOrigin = API_BASE_URL || window.location.origin;
        resolve({ ok: true, url: new URL(result.path, apiOrigin).toString() });
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsDataURL(file);
  }),
};
