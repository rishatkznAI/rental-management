import { useEffect, useState } from 'react';
import { frontendBuildInfo, installFrontendBuildInfo, shouldShowBuildDebug } from '../../lib/build-info';

export function BuildDebugBadge() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    installFrontendBuildInfo();
    setVisible(shouldShowBuildDebug());
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-2 left-2 z-[1000] max-w-[min(24rem,calc(100vw-1rem))] rounded border border-slate-300 bg-white/95 px-3 py-2 text-[11px] leading-5 text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-950/95 dark:text-slate-200">
      <div><span className="font-semibold">FE</span> {frontendBuildInfo.commit || 'unknown'}</div>
      <div><span className="font-semibold">Build</span> {frontendBuildInfo.buildTime || 'unknown'}</div>
      <div className="truncate"><span className="font-semibold">API</span> {frontendBuildInfo.apiBaseUrl}</div>
    </div>
  );
}
