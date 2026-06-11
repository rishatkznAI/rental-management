const DEMO_MODE_ENABLED = String(import.meta.env.VITE_DEMO_MODE || '').toLowerCase() === 'true'
  || String(import.meta.env.VITE_DEMO_MODE || '') === '1';

const configuredBrandName = String(
  import.meta.env.VITE_APP_BRAND_NAME
  || import.meta.env.VITE_APP_NAME
  || '',
).trim();

export const APP_BRAND_NAME = configuredBrandName || (DEMO_MODE_ENABLED ? 'Rental Management Demo' : 'rentCore');
