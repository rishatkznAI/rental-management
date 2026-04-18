/**
 * useSyncData — legacy compatibility hook.
 *
 * Business collections now live in the API + React Query cache.
 * The hook keeps only one responsibility: after a successful auth bootstrap,
 * invalidate queries so every screen refetches fresh server data.
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';

export function useSyncData(): void {
  const { isAuthenticated, isLoading } = useAuth();
  const syncedRef = useRef(false);
  const qc = useQueryClient();

  useEffect(() => {
    // Only run once per auth session, after auth check completes
    if (isLoading || !isAuthenticated || syncedRef.current) return;
    syncedRef.current = true;

    qc.invalidateQueries();
  }, [isAuthenticated, isLoading, qc]);

  // Reset sync flag on logout so next login triggers a fresh sync
  useEffect(() => {
    if (!isAuthenticated && !isLoading) {
      syncedRef.current = false;
    }
  }, [isAuthenticated, isLoading]);
}
