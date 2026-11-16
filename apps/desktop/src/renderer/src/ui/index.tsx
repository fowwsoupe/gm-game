import type { ReactNode } from 'react';
import { useUi } from '@/stores/ui';

export { Face } from './Face';

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

/**
 * Player card: name, subtitle (position, team, age) and a stack of percentile bars.
 * Callers pass already-translated labels; the card holds no text of its own.
 */
export function PlayerCard({
  name,
  subtitle,
  bars,
  face,
  className = '',
}: {
  name: string;
  subtitle?: ReactNode;
  /** Optional portrait (e.g. a generated `Face`). */
  face?: ReactNode;
  bars: { label: string; value: number }[];
  className?: string;
}) {
  return (
    <Card className={className}>
      <div className="mb-3 flex items-center gap-3">
        {face}
        <div className="border-l-4 border-[var(--team-primary)] pl-3">
          <div className="text-lg font-semibold leading-tight">{name}</div>
          {subtitle && <div className="text-sm text-muted">{subtitle}</div>}
        </div>
      </div>
      <div className="space-y-1.5">
        {bars.map((b) => (
          <PercentileBar key={b.label} label={b.label} value={b.value} />
        ))}
      </div>
    </Card>
  );
}

/**
 * Broadcast caption: a lower-third for big moments (goal, series win, trophy).
 * Team-coloured edge; `kicker` is the small label above the headline.
 */
export function BroadcastCaption({
  kicker,
  headline,
  detail,
}: {
  kicker?: ReactNode;
  headline: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="flex max-w-xl overflow-hidden rounded-md border border-line bg-panel shadow-lg">
      <div className="w-1.5 shrink-0 bg-[var(--team-primary)]" />
      <div className="px-3 py-2">
        {kicker && (
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--team-primary)]">
            {kicker}
          </div>
        )}
        <div className="text-base font-semibold leading-tight">{headline}</div>
        {detail && <div className="text-sm text-muted">{detail}</div>}
      </div>
    </div>
  );
}

/** A range on a 0–100 track (a scouted potential range): the band from `low` to `high`. */
export function RangeBar({ low, high }: { low: number; high: number }) {
  const lo = Math.max(0, Math.min(100, low));
  const hi = Math.max(lo, Math.min(100, high));
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
        <div
          className="absolute h-full bg-accent"
          style={{ left: `${lo}%`, width: `${hi - lo}%` }}
        />
      </div>
      <span className="tabular w-14 text-right">
        {lo}–{hi}
      </span>
    </div>
  );
}

/** A team name that opens that team's page. */
export function TeamLink({ teamId, children }: { teamId: string; children: ReactNode }) {
  const openTeam = useUi((s) => s.openTeam);
  return (
    <button onClick={() => openTeam(teamId)} className="hover:underline">
      {children}
    </button>
  );
}
