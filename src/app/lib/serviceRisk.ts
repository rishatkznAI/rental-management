export type ServiceRiskLevel = 'low' | 'medium' | 'high';

export interface ServiceRiskMetrics {
  repairsCount: number;
  totalNormHours: number;
  partsCost: number;
}

export interface ServiceRiskAssessment {
  level: ServiceRiskLevel;
  label: string;
  badgeClass: string;
}

export function assessServiceRisk(metrics: ServiceRiskMetrics): ServiceRiskAssessment {
  if (metrics.repairsCount >= 5 || metrics.totalNormHours >= 20 || metrics.partsCost >= 150000) {
    return {
      level: 'high',
      label: 'Высокий риск',
      badgeClass: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    };
  }

  if (metrics.repairsCount >= 3 || metrics.totalNormHours >= 12 || metrics.partsCost >= 100000) {
    return {
      level: 'medium',
      label: 'Зона внимания',
      badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    };
  }

  return {
    level: 'low',
    label: 'Низкий риск',
    badgeClass: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  };
}
