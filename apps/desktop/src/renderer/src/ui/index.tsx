import type { ReactNode } from 'react';

/**
 * Design-system components. Screens are built from these, not from raw divs with
 * one-off styles, so the whole game looks like one product. Add components here first.
 */

export function Card({
  title,
  children,
  className = '',
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[var(--radius-card)] border border-line bg-panel p-4 ${className}`}
    >
      {title && (
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
      )}
      {children}
    </section>
  );
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost';
};

export function Button({ children, onClick, disabled, variant = 'ghost' }: ButtonProps) {
  const styles =
    variant === 'primary'
      ? 'bg-[var(--team-primary)] text-bg font-medium'
      : 'border border-line text-ink hover:bg-panel-2';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-40 ${styles}`}
    >
      {children}
    </button>
  );
}

/**
 * A percentile bar: the core visual of player cards (no overall rating).
 * 0–100, coloured with the shared good / neutral / bad scale.
 */
export function PercentileBar({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const colour = v >= 70 ? 'bg-good' : v <= 30 ? 'bg-bad' : 'bg-neutral';
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-28 shrink-0 text-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
        <div className={`h-full ${colour}`} style={{ width: `${v}%` }} />
      </div>
      <span className="tabular w-8 text-right">{v}</span>
    </div>
  );
}
