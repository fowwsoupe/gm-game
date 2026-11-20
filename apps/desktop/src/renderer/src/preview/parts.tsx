import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Face } from './graphics';
import { fitsOf, stars } from './profile';
import { byId, fmtM, type Player } from './mock';
import { usePv } from './store';

/* ---------- Portrait: Face-backed frame; see graphics.tsx and GRAPHICS.md ---------- */
export function Portrait({
  num,
  id,
  team,
  showNumber = true,
}: {
  num: number;
  id: string;
  team?: string;
  showNumber?: boolean;
}) {
  const t = usePv((s) => s.team);
  return (
    <div className="ptr">
      <Face id={id} team={team ?? t} num={num} />
      {showNumber && <div className="jersey-num">{num}</div>}
    </div>
  );
}

/* ---------- Num: the list/table stand-in for a face ---------- */
export const Num = ({ n }: { n: number }) => <span className="num">{n}</span>;

/* ---------- Roll: numbers roll when they change ---------- */
export function Roll({
  v,
  fmt = (n: number) => String(Math.round(n)),
  ms = 520,
}: {
  v: number;
  fmt?: (n: number) => string;
  ms?: number;
}) {
  const calm = usePv((s) => s.calm);
  const [d, setD] = useState(v);
  const from = useRef(v);
  useEffect(() => {
    if (calm || from.current === v) {
      from.current = v;
      setD(v);
      return;
    }
    const a = from.current;
    const t0 = performance.now();
    let id = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const cur = a + (v - a) * (1 - Math.pow(1 - k, 3));
      from.current = cur;
      setD(cur);
      if (k < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [v, calm, ms]);
  return <>{fmt(d)}</>;
}

/* ---------- Name: hover peeks, click opens the drawer, right-click opens the menu ---------- */
export function useRowActions(id: string) {
  const { setPeek, open, setMenu } = usePv();
  const timer = useRef(0);
  return {
    onMouseEnter: (e: React.MouseEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setPeek({ id, x, y }), 160);
    },
    onMouseLeave: () => {
      window.clearTimeout(timer.current);
      setPeek(null);
    },
    onClick: () => open(id),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      setMenu({ id, x: e.clientX, y: e.clientY });
    },
  };
}
export function Name({ id, children }: { id: string; children?: ReactNode }) {
  const a = useRowActions(id);
  const pl = byId(id);
  return (
    <span
      className="nm"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && a.onClick()}
      {...a}
    >
      {children ?? pl?.name}
    </span>
  );
}

export const statLine = (p: Player): string =>
  p.pos === 'G'
    ? `${p.svp?.toFixed(3).slice(1)} SV% · ${(p.gsax ?? 0) > 0 ? '+' : ''}${p.gsax} GSAx`
    : `${p.g}–${p.a}–${p.g + p.a} · ${p.xgf.toFixed(1)} xGF%`;
export const capStr = (p: Player): string => fmtM(p.capHit);

/* ---------- F: a fact. Every place a fact shows is tagged so the dev check can compare them ---------- */
export const F = ({ k, v, children }: { k: string; v: string | number; children?: ReactNode }) => (
  <span data-fact={k} data-v={String(v)}>
    {children ?? v}
  </span>
);

/* ---------- Segmented: iOS-style control, the thumb slides ---------- */
export function Segmented<T extends string>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)}>
          {value === o.id && (
            <motion.span
              layoutId={`seg-${id}`}
              className="seg-thumb"
              transition={{ type: 'spring', stiffness: 500, damping: 36 }}
            />
          )}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- Rate: role-fit stars by default, OVR number when the dev toggle is on ---------- */
export function Rate({ p, size = 'sm' }: { p: Player; size?: 'sm' | 'lg' }) {
  const ovr = usePv((s) => s.ovr);
  if (ovr) return <b className={`rate-ovr ${size}`}>{p.ovr}</b>;
  const fit = fitsOf(p)[0]!;
  return (
    <span className={`rate-fit ${size}`} title={`${fit.role}: ${fit.stars} of 5`}>
      <i>{stars(fit.stars)}</i>
      {size === 'lg' && <small>{fit.role}</small>}
    </span>
  );
}
