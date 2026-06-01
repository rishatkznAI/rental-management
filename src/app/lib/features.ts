function envFlagEnabled(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value || '').trim().toLowerCase());
}

export const isCrmEnabled = envFlagEnabled(import.meta.env.VITE_CRM_ENABLED);
