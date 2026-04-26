import { cn } from '../../lib/utils';

type LiftLogoProps = {
  className?: string;
};

export function LiftLogo({ className }: LiftLogoProps) {
  return (
    <svg
      viewBox="0 0 96 96"
      role="img"
      aria-label="Скайтех"
      className={cn('shrink-0 rounded-xl shadow-[0_12px_30px_-16px_rgba(212,247,74,0.95)]', className)}
    >
      <rect width="96" height="96" rx="24" fill="#D7FF32" />
      <path
        d="M27 28H69M32 34H64M48 34V42M35 42L61 64M61 42L35 64M35 64H61M30 70H66"
        stroke="#16191F"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="35" cy="76" r="4" fill="#16191F" />
      <circle cx="61" cy="76" r="4" fill="#16191F" />
    </svg>
  );
}
