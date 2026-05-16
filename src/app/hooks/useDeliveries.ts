import { useQuery } from '@tanstack/react-query';
import { deliveriesService } from '../services/deliveries.service';
import type { PaginatedQueryParams } from '../lib/api';

export const DELIVERY_QUERY_KEYS = {
  all: ['deliveries'] as const,
  paginated: (params: PaginatedQueryParams, scope = 'default') => ['deliveries', 'paginated', scope, params] as const,
  carriers: ['delivery-carriers'] as const,
};

type QueryOptions = {
  enabled?: boolean;
  scope?: string;
};

export function usePaginatedDeliveries(params: PaginatedQueryParams, options: QueryOptions = {}) {
  return useQuery({
    queryKey: DELIVERY_QUERY_KEYS.paginated(params, options.scope),
    queryFn: () => deliveriesService.getPaginated(params),
    enabled: options.enabled ?? true,
    staleTime: 1000 * 60,
    placeholderData: previous => previous,
  });
}
