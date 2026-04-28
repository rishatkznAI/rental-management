import { API_BASE_URL } from './api';

declare const __APP_COMMIT_HASH__: string;
declare const __APP_BUILD_TIME__: string;

export type FrontendBuildInfo = {
  service: 'frontend';
  commit: string;
  buildTime: string;
  apiBaseUrl: string;
  mode: string;
};

export const frontendBuildInfo: FrontendBuildInfo = {
  service: 'frontend',
  commit: typeof __APP_COMMIT_HASH__ === 'string' ? __APP_COMMIT_HASH__ : '',
  buildTime: typeof __APP_BUILD_TIME__ === 'string' ? __APP_BUILD_TIME__ : '',
  apiBaseUrl: API_BASE_URL || window.location.origin,
  mode: import.meta.env.MODE,
};

declare global {
  interface Window {
    __SKYTECH_BUILD_INFO__?: FrontendBuildInfo;
  }
}

export function installFrontendBuildInfo() {
  window.__SKYTECH_BUILD_INFO__ = frontendBuildInfo;
  console.info('[Skytech build]', frontendBuildInfo);
}

export function shouldShowBuildDebug(search = window.location.search) {
  const params = new URLSearchParams(search);
  if (params.get('debugVersion') === '1') {
    window.localStorage.setItem('skytech_debug_version', '1');
    return true;
  }
  if (params.get('debugVersion') === '0') {
    window.localStorage.removeItem('skytech_debug_version');
    return false;
  }
  return window.localStorage.getItem('skytech_debug_version') === '1';
}
