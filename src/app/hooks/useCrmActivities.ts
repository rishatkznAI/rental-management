import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { crmActivitiesService, type CrmActivityFilters } from '../services/crm-activities.service';
import type { CrmActivityInput } from '../types';

export const CRM_ACTIVITY_KEYS = {
  all: ['crm-activities'] as const,
  list: (filters?: CrmActivityFilters) => ['crm-activities', filters || {}] as const,
  kpi: (filters?: CrmActivityFilters) => ['crm-manager-kpi', filters || {}] as const,
};

export function useCrmActivities(filters?: CrmActivityFilters, enabled = true) {
  return useQuery({
    queryKey: CRM_ACTIVITY_KEYS.list(filters),
    queryFn: async () => (await crmActivitiesService.getAll(filters)).items,
    enabled,
  });
}

export function useCrmManagerKpi(filters?: CrmActivityFilters, enabled = true) {
  return useQuery({
    queryKey: CRM_ACTIVITY_KEYS.kpi(filters),
    queryFn: () => crmActivitiesService.getManagerKpi(filters),
    enabled,
  });
}

export function useCreateCrmActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CrmActivityInput) => crmActivitiesService.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CRM_ACTIVITY_KEYS.all });
      queryClient.invalidateQueries({ queryKey: ['crm-manager-kpi'] });
    },
  });
}
