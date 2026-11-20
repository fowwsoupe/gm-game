// Graphics system. No code-drawn illustrations: portraits and scenes are image files (pack, then
// placeholder-art, which is gitignored), else a dark textured frame. Crests are flat monograms.
//   /graphics/logos/<TEAM>.png   team crest      /graphics/faces/<playerId>.png   player portrait
//   /graphics/slots/<slot>.jpg   event hero image
// Never commit real NHL logos or player photos.
import { useEffect, useState } from 'react';

const BASE = import.meta.env.BASE_URL;
const hash = (s: string): number => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
/** Resolves to the pack file if it exists, else null. Cached so lists do not refetch. */
const seen = new Map<string, boolean>();
function useOverride(path: string): string | null {
  const url = `${BASE}${path}`;
  const [ok, setOk] = useState<boolean | undefined>(seen.get(url));
  useEffect(() => {
    if (seen.has(url)) return setOk(seen.get(url));
    const i = new Image();
    i.onload = () => (seen.set(url, true), setOk(true));
    i.onerror = () => (seen.set(url, false), setOk(false));
    i.src = url;
  }, [url]);
  return ok ? url : null;
}

const KNOWN: Record<string, [string, string]> = {
  MTL: ['#af1e2d', '#e8e2d4'],
  TOR: ['#1d4f9f', '#e8eef7'],
  BOS: ['#f0b323', '#14110a'],
  SJS: ['#0e7c86', '#e6f2f2'],
  FLA: ['#b3202e', '#0e2a54'],
  TBL: ['#1b4d9c', '#f3f6fb'],
  OTT: ['#b5222f', '#171717'],
  BUF: ['#1a3f86', '#e7b52b'],
  DET: ['#c4202d', '#f2f2f2'],
};
export const teamColors = (ab: string): [string, string] => {
  const k = KNOWN[ab];
  if (k) return k;
  const h = hash(ab);
  return [`hsl(${h % 360} 58% 38%)`, h % 2 ? '#ecebe6' : '#15151a'];
};

/* ---------- TeamMark: flat monogram crest ---------- */
export function TeamMark({ ab, size = 24 }: { ab: string; size?: number }) {
  const img = useOverride(`graphics/logos/${ab}.png`);
  const [a, b] = teamColors(ab);
  if (img)
    return <img src={img} alt={ab} width={size} height={size} style={{ objectFit: 'contain' }} />;
  const label = size < 24 ? ab[0]! : ab;
  return (
    <span
      role="img"
      aria-label={ab}
      style={{
        width: size,
        height: size,
        borderRadius: size > 40 ? 14 : 6,
        background: a,
        color: b,
        boxShadow: `inset 0 0 0 ${size > 40 ? 3 : 1.5}px ${b}`,
        display: 'inline-grid',
        placeItems: 'center',
        flex: 'none',
        font: `700 ${Math.round(size * (label.length > 1 ? 0.36 : 0.55))}px/1 var(--d, 'Barlow Condensed')`,
        letterSpacing: '.02em',
      }}
    >
      {label}
    </span>
  );
}

/* ---------- Textured frame: what shows when an image is missing ---------- */
function Frame({ team, text, big }: { team: string; text?: string | number; big?: boolean }) {
  const [a] = teamColors(team);
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: `radial-gradient(120% 90% at 50% 20%, ${a}55, transparent 70%), repeating-linear-gradient(135deg, #ffffff08 0 2px, transparent 2px 9px), #0c0f16`,
        font: `700 ${big ? 96 : 40}px/1 var(--d, 'Barlow Condensed')`,
        color: '#ffffff30',
      }}
    >
      {text}
    </div>
  );
}

/* ---------- Face: portrait image, normalised; no drawn faces ---------- */
export function Face({
  id,
  team = 'MTL',
  num,
}: {
  id: string;
  team?: string;
  num?: number | string;
}) {
  const pack = useOverride(`graphics/faces/${id}.png`);
  const ph = useOverride(`graphics/placeholder-art/portraits/${id}.jpg`);
  const img = pack ?? ph;
  if (img)
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#0c0f16' }}>
        <img
          src={img}
          alt=""
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'top',
            filter: 'contrast(1.05) saturate(.92)',
          }}
        />
      </div>
    );
  return <Frame team={team} text={num ?? team} big />;
}

/* ---------- SceneImage: behind content, blurred, darkened, never clickable ---------- */
export const SCENE_SLOTS = [
  'arenaExterior',
  'arenaInterior',
  'tunnelArrival',
  'draftStage',
  'warRoom',
  'trainingCamp',
  'roadTrip',
  'awardsGala',
] as const;
export type SceneSlot = (typeof SCENE_SLOTS)[number];
export type TimeOfDay = 'day' | 'dusk' | 'night';
export function SceneImage({
  slot,
  team = 'MTL',
  who,
  blur = 3,
  dim = 0.55,
}: {
  slot: SceneSlot;
  team?: string;
  city?: string;
  time?: TimeOfDay;
  who?: string;
  num?: number;
  blur?: number;
  dim?: number;
}) {
  const pack = useOverride(`graphics/scenes/${slot}/${who ?? team}.jpg`);
  const ph = useOverride(`graphics/placeholder-art/scenes/${slot}.jpg`);
  const src = pack ?? ph;
  const [a] = teamColors(team);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
        background: '#07090e',
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: `blur(${blur}px) saturate(.9)`,
            transform: 'scale(1.06)',
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(90% 70% at 50% 0%, ${a}30, transparent 70%), repeating-linear-gradient(135deg, #ffffff06 0 2px, transparent 2px 11px)`,
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(180deg, rgba(7,9,14,${dim * 0.6}), rgba(7,9,14,${dim + 0.2}))`,
        }}
      />
    </div>
  );
}
