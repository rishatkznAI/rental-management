import { cn } from '../../lib/utils';
import rentCoreLogoUrl from '../../../assets/rentcore-logo.png';

type LiftLogoProps = {
  className?: string;
};

export function LiftLogo({ className }: LiftLogoProps) {
  return (
    <img
      src={rentCoreLogoUrl}
      width="36"
      height="36"
      alt="rentCore"
      className={cn('shrink-0 rounded-xl object-contain shadow-[0_12px_30px_-16px_rgba(212,247,74,0.95)]', className)}
    />
  );
}
