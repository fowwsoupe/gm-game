import { useEffect, useRef, useState, type RefObject } from 'react';
import { blend, puckAt, scene, type RinkGame, type Scene } from '@/lib/rink';

// Colours come from CSS variables (the app's tokens unless a host sets its own) and the two team
// colours from props, so any theme can host the rink.
const ICE = 'var(--rink-ice, var(--color-panel-2))';
const BOARDS = 'var(--rink-line, var(--color-muted))';
const BLUE = 'var(--rink-blue, var(--color-good))';
const RED = 'var(--rink-red, var(--color-bad))';
const PUCK = 'var(--rink-puck, var(--color-ink))';
/** Nodes moved every frame follow the clock, not the stylesheet's transitions. */
const DIRECT = { transition: 'none' } as const;

/**
 * A game clock for a viewer: `at` holds the game second for whatever draws every frame, `clock`
 * follows it ten times a second for the React side (score, feed). `speed` is game seconds a second.
 */
export function useGameClock(end: number, initialSpeed: number) {
  const at = useRef(0);
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(initialSpeed);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let shown = last;
    let frame = requestAnimationFrame(function tick(now: number) {
      // A hidden window gets no frames: carry on from where it stopped, never jump ahead.
      at.current = Math.min(end, at.current + (Math.min(now - last, 100) / 1000) * speed);
      last = now;
      if (at.current >= end) return setPlaying(false);
      if (now - shown >= 100) {
        shown = now;
        setClock(at.current);
      }
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      setClock(at.current);
    };
  }, [playing, speed, end]);
  const seek = (second: number, play: boolean) => {
    at.current = second;
    setClock(second);
    setPlaying(play);
  };
  return { at, clock, playing, speed, setPlaying, setSpeed, seek };
}

/** A side is told by shape, never by hue alone: home a solid disc, away a ring, a goalie a second ring. */
function Mark({ away, goalie, color }: { away?: boolean; goalie?: boolean; color: string }) {
  return (
    <>
      {goalie && <circle r="4.1" fill="none" stroke={color} strokeWidth="0.7" />}
      <circle
        r={away ? 2.1 : 2.6}
        fill={away ? ICE : color}
        stroke={color}
        strokeWidth={away ? 1.1 : 0}
      />
    </>
  );
}

/** One mark on its own, for a legend. */
export function DiscMark(props: { away?: boolean; goalie?: boolean; color: string }) {
  return (
    <svg viewBox="-5 -5 10 10" className="mr-1 inline-block h-3.5 w-3.5 align-[-2px]" aria-hidden>
      <Mark {...props} />
    </svg>
  );
}

/**
 * The rink: a disc for everyone on the ice, the puck and its trail, drawn from `scene` at the game
 * second in `at`. One animation-frame loop writes each node's place; React renders the nodes once.
 */
export function Rink({
  game,
  at,
  colors,
  names = {},
  calm = false,
  label,
}: {
  /** Keep the same object between renders (memo it). */
  game: RinkGame;
  at: RefObject<number>;
  /** [home, away] */
  colors: readonly [string, string];
  /** Player id to name, for the hover text. */
  names?: Record<string, string>;
  /** Reduced motion: discs jump from event to event, no trail, no goal light. The system setting asks for it too. */
  calm?: boolean;
  label: string;
}) {
  const root = useRef<SVGSVGElement>(null);
  const shown = useRef<Scene | null>(null);
  const still = calm || matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    const svg = root.current!;
    const nodes = new Map<string, SVGGElement>();
    svg.querySelectorAll<SVGGElement>('[data-disc]').forEach((g) => nodes.set(g.dataset.disc!, g));
    const puck = svg.querySelector('[data-puck]')!;
    const trail = svg.querySelector('[data-trail]')!;
    const nets = [0, 1].map((n) => svg.querySelector(`[data-net="${n}"]`)!);
    // A new game under the same clock (a bench order): a quarter of a second from the picture
    // that was to the new one, whether the clock runs or not.
    const from = still ? null : shown.current;
    const since = performance.now();
    let drawn = NaN;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const t = at.current;
      if (t === drawn) return;
      const u = from ? (performance.now() - since) / 250 : 1;
      drawn = u < 1 ? NaN : t;
      const to = scene(game, t, still);
      shown.current = to;
      const s = from && u < 1 ? blend(from, to, u) : to;
      const seen = new Set<SVGGElement>();
      for (const d of s.discs) {
        const g = nodes.get(`${d.side}:${d.k < 0 ? (d.relief ? 'r' : 'g') : d.k}`);
        if (!g) continue;
        seen.add(g);
        g.setAttribute('transform', `translate(${d.x.toFixed(2)} ${d.y.toFixed(2)})`);
        g.setAttribute('opacity', String(d.alpha));
        g.setAttribute('display', 'inline');
      }
      nodes.forEach((g) => seen.has(g) || g.setAttribute('display', 'none'));
      puck.setAttribute('transform', `translate(${s.puck[0].toFixed(2)} ${s.puck[1].toFixed(2)})`);
      // The trail: where the puck was over the last two game seconds.
      const points =
        still || u < 1
          ? []
          : Array.from({ length: 9 }, (_, i) =>
              puckAt(game, t - i * 0.25)
                .map((v) => v.toFixed(1))
                .join(','),
            );
      trail.setAttribute('points', points.join(' '));
      nets.forEach((net, n) => net.setAttribute('fill', !still && s.goal === n ? RED : 'none'));
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [game, at, still]);

  const sides = [game.box.home, game.box.away] as const;
  return (
    <svg ref={root} viewBox="-104 -50 208 100" role="img" aria-label={label} className="w-full">
      {/* Benches below the boards, penalty boxes above; the home side's are on its own half. */}
      {[-34, 4].map((x) => (
        <rect key={x} x={x} y="42.5" width="30" height="6" fill={ICE} opacity="0.6" />
      ))}
      {[-18, 2].map((x) => (
        <rect key={x} x={x} y="-48.5" width="16" height="6" fill={ICE} opacity="0.6" />
      ))}
      <rect
        x="-100"
        y="-42.5"
        width="200"
        height="85"
        rx="28"
        fill={ICE}
        stroke={BOARDS}
        strokeWidth="0.8"
      />
      <line y1="-42.5" y2="42.5" stroke={RED} strokeWidth="1" opacity="0.8" />
      <circle r="15" fill="none" stroke={BLUE} strokeWidth="0.4" opacity="0.8" />
      {([-1, 1] as const).map((d) => (
        <g key={d} transform={`scale(${d} 1)`}>
          <line x1="25" x2="25" y1="-42.5" y2="42.5" stroke={BLUE} strokeWidth="1" opacity="0.8" />
          <line x1="89" x2="89" y1="-36.7" y2="36.7" stroke={RED} strokeWidth="0.4" opacity="0.8" />
          <path d="M 89 -6 A 6 6 0 0 0 89 6 Z" fill={BLUE} opacity="0.25" />
          {[-22, 22].map((y) => (
            <g key={y} opacity="0.5">
              <circle cx="69" cy={y} r="15" fill="none" stroke={RED} strokeWidth="0.4" />
              <circle cx="69" cy={y} r="1" fill={RED} />
            </g>
          ))}
        </g>
      ))}
      {/* Each net lights up when the side attacking it scores: the home side attacks the right one. */}
      {[0, 1].map((n) => (
        <rect
          key={n}
          data-net={n}
          x={n === 0 ? 89 : -92.5}
          y="-3"
          width="3.5"
          height="6"
          fill="none"
          stroke={RED}
          strokeWidth="0.5"
        />
      ))}
      <polyline
        data-trail
        fill="none"
        stroke={PUCK}
        strokeWidth="0.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.35"
        style={DIRECT}
      />
      {sides.map((side, n) => {
        const mark = (key: string, id: string, goalie = false) => (
          <g key={key} data-disc={`${n}:${key}`} display="none" style={DIRECT}>
            <title>{names[id] ?? id}</title>
            <Mark away={n === 1} goalie={goalie} color={colors[n]!} />
          </g>
        );
        return [
          ...side.skaters.map((line, k) => mark(String(k), line.id)),
          mark('g', side.goalie.id, true),
          side.relief && mark('r', side.relief.id, true),
        ];
      })}
      <circle data-puck r="1.1" fill={PUCK} style={DIRECT} />
    </svg>
  );
}
