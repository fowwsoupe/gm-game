/**
 * Design-system components. Screens are built from these, not from raw divs with
 * one-off styles, so the whole game looks like one product. Add components here first.
 */

import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import type { Team, TeamId } from '@gm/shared';
import { useUi } from '@/stores/ui';

export { Face, PersonFace } from './Face';
export { Cutscene } from './Cutscene';
export { TrophyLift } from './TrophyLift';
export { Palette, type PaletteItem } from './Palette';

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

/**
 * Pick a team by full name. `empty` adds a first option with value '' (pass '' for a blank one).
 */
export function TeamSelect({
  teams,
  value,
  onChange,
  empty,
  className = '',
}: {
  teams: readonly Team[];
  value: string;
  onChange: (id: TeamId | '') => void;
  empty?: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as TeamId | '')}
      className={`rounded border border-line bg-panel px-2 py-1 text-sm text-ink ${className}`}
    >
      {empty !== undefined && <option value="">{empty}</option>}
      {teams.map((x) => (
        <option key={x.id} value={x.id}>
          {x.city} {x.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Table cells with the shared padding. Numbers right-align (the row sets `text-right`);
 * pass `left` for text columns.
 */
export function Th({
  left,
  className = '',
  ...rest
}: { left?: boolean } & ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th {...rest} className={`px-2 py-1.5 font-medium ${left ? 'text-left' : ''} ${className}`} />
  );
}

export function Td({
  left,
  className = '',
  ...rest
}: { left?: boolean } & TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...rest} className={`px-2 py-1.5 ${left ? 'text-left' : ''} ${className}`} />;
}

/** A small heading inside a card or screen. */
export function SectionHeader({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-sm font-semibold">{children}</h3>;
}

/**
 * Bars (each one's sign coloured good or bad) with a line over them, on one scale, oldest left.
 * `labels` mark the start of each group (a season) along the bottom.
 */
export function BarLineChart({
  bars,
  line,
  labels,
}: {
  bars: number[];
  line: number[];
  labels: { at: number; text: string }[];
}) {
  const w = 600;
  const h = 160;
  const top = Math.max(0, ...bars, ...line);
  const bottom = Math.min(0, ...bars, ...line);
  const y = (v: number) => (top === bottom ? h / 2 : ((top - v) / (top - bottom)) * h);
  const step = w / Math.max(1, bars.length);
  return (
    <svg viewBox={`0 0 ${w} ${h + 14}`} className="w-full" role="img">
      <line x1={0} x2={w} y1={y(0)} y2={y(0)} className="stroke-line" />
      {bars.map((v, i) => (
        <rect
          key={i}
          x={i * step + step * 0.15}
          width={step * 0.7}
          y={Math.min(y(v), y(0))}
          height={Math.abs(y(v) - y(0))}
          className={v >= 0 ? 'fill-good' : 'fill-bad'}
        />
      ))}
      <polyline
        points={line.map((v, i) => `${i * step + step / 2},${y(v)}`).join(' ')}
        fill="none"
        className="stroke-accent"
        strokeWidth={2}
      />
      {labels.map((l) => (
        <text key={l.at} x={l.at * step} y={h + 12} className="fill-muted text-[10px]">
          {l.text}
        </text>
      ))}
    </svg>
  );
}

/** One headline number: a small label over a big value, with an optional note. */
export function StatRow({
  label,
  value,
  note,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className="tabular text-lg font-semibold">{value}</div>
      {note && <div className="tabular text-xs text-muted">{note}</div>}
    </div>
  );
}
