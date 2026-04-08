/**
 * useSyncData — populates localStorage from server on auth.
 *
 * When the user logs in (or the page loads with a valid token), this hook
 * fetches all business data from the server and writes it into localStorage.
 * This allows pages that still read from localStorage to see server-side data
 * on any device (cross-device sync).
 *
 * This is a "bridge" hook: once all pages are fully migrated to react-query +
 * service layer, this hook can be removed.
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import {
  EQUIPMENT_STORAGE_KEY,
  RENTALS_STORAGE_KEY,
  GANTT_RENTALS_STORAGE_KEY,
  SERVICE_STORAGE_KEY,
  CLIENTS_STORAGE_KEY,
  DOCUMENTS_STORAGE_KEY,
  PAYMENTS_STORAGE_KEY,
  SHIPPING_PHOTOS_KEY,
  OWNERS_STORAGE_KEY,
} from '../mock-data';
import { USERS_STORAGE_KEY } from '../lib/userStorage';

const COLLECTION_MAP: Record<string, string> = {
  [EQUIPMENT_STORAGE_KEY]:      'equipment',
  [RENTALS_STORAGE_KEY]:        'rentals',
  [GANTT_RENTALS_STORAGE_KEY]:  'gantt_rentals',
  [SERVICE_STORAGE_KEY]:        'service',
  [CLIENTS_STORAGE_KEY]:        'clients',
  [DOCUMENTS_STORAGE_KEY]:      'documents',
  [PAYMENTS_STORAGE_KEY]:       'payments',
  [SHIPPING_PHOTOS_KEY]:        'shipping_photos',
  [OWNERS_STORAGE_KEY]:         'owners',
  [USERS_STORAGE_KEY]:          'users',
};

export function useSyncData(): void {
  const { isAuthenticated, isLoading } = useAuth();
  const syncedRef = useRef(false);
  const qc = useQueryClient();

  useEffect(() => {
    // Only run once per auth session, after auth check completes
    if (isLoading || !isAuthenticated || syncedRef.current) return;
    syncedRef.current = true;

    async function syncAll() {
      for (const [storageKey, collection] of Object.entries(COLLECTION_MAP)) {
        try {
          const data = await api.get<unknown[]>(`/api/${collection}`);
          if (Array.isArray(data)) {
            localStorage.setItem(storageKey, JSON.stringify(data));
          }
        } catch {
          // Silently ignore — localStorage retains last-known data
        }
      }
      // Invalidate all react-query caches so freshly synced data is reflected
      qc.invalidateQueries();
    }

    syncAll();
  }, [isAuthenticated, isLoading, qc]);

  // Reset sync flag on logout so next login triggers a fresh sync
  useEffect(() => {
    if (!isAuthenticated && !isLoading) {
      syncedRef.current = false;
    }
  }, [isAuthenticated, isLoading]);
}
