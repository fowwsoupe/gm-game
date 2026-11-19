/**
 * Generated face: the same player always gets the same face (built from his id), and it ages
 * with him (lines from 30, grey from 34). Plain SVG, no assets. Skin and hair palettes are data
 * for faces only, not UI colours, so they live here rather than in the design tokens.
 */
const SKIN = ['#f1c7a8', '#e0ac85', '#c98e66', '#a86f4b', '#7d5236', '#5b3a26'];
const HAIR = ['#1f1a17', '#3b2a1e', '#6b4a2b', '#a87b4f', '#d8b77a', '#8c3b1e'];
const GREY = '#b8b8b8';
const EYES = ['#1b1b1b', '#3a2a1a', '#2f5d7c', '#3f6b4a', '#6b6b6b'];

/** FNV-1a: a stable 32-bit number from a string. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A front-office face (GM, coach, owner): seeded by role and name, a stable age 40-70. */
export const PersonFace = ({
  role,
  name,
  size = 64,
}: {
  role: string;
  name: string;
  size?: number;
}) => <Face seed={`${role}:${name}`} age={40 + (hash(name) % 31)} size={size} />;

export function Face({ seed, age, size = 64 }: { seed: string; age: number; size?: number }) {
  const h = hash(seed);
  const pick = (n: number, shift: number) => Math.floor((((h >>> shift) % 997) / 997) * n);
  const skin = SKIN[pick(SKIN.length, 0)]!;
  const hair = age >= 34 ? GREY : HAIR[pick(HAIR.length, 3)]!;
  const style = pick(6, 6);
  const facial = pick(5, 9); // 0 full beard, 1 stubble, 2 moustache, else clean
  const eye = EYES[pick(EYES.length, 24)]!;
  const scar = pick(9, 27) === 0;
  const ears = pick(3, 2); // 0 small, 1 medium, 2 large
  const jaw = 26 + pick(5, 12); // face width
  const eyeY = 46 + pick(4, 15);
  const brow = pick(3, 18) - 1; // brow tilt
  const mouth = pick(3, 21); // 0 flat, 1 smile, 2 slight
  const lines = age >= 30;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      className={size < 32 ? 'mr-2 inline-block align-middle' : undefined}
    >
      <rect width="100" height="100" rx="12" fill="var(--color-panel-2)" />
      {/* neck and shoulders, in the team colour */}
      <path d="M20 100 Q50 78 80 100 Z" fill="var(--team-primary)" />
      <rect x="42" y="70" width="16" height="14" fill={skin} />
      {/* head */}
      <ellipse cx={50 - jaw} cy="52" rx={2 + ears} ry={4 + ears} fill={skin} />
      <ellipse cx={50 + jaw} cy="52" rx={2 + ears} ry={4 + ears} fill={skin} />
      <ellipse cx="50" cy="50" rx={jaw} ry="30" fill={skin} />
      {/* hair */}
      {style === 0 && (
        <path d={`M${50 - jaw} 44 Q50 8 ${50 + jaw} 44 Q50 26 ${50 - jaw} 44 Z`} fill={hair} />
      )}
      {style === 1 && (
        <path
          d={`M${50 - jaw} 48 Q46 6 ${50 + jaw} 46 L${50 + jaw - 4} 34 Q50 24 ${54 - jaw} 36 Z`}
          fill={hair}
        />
      )}
      {style === 2 && (
        <rect x={50 - jaw + 4} y="20" width={2 * jaw - 8} height="10" rx="5" fill={hair} />
      )}
      {style === 3 && (
        <path
          d={`M${50 - jaw} 50 Q50 2 ${50 + jaw} 50 Q${50 + jaw - 2} 30 50 28 Q${52 - jaw} 30 ${50 - jaw} 50 Z`}
          fill={hair}
        />
      )}
      {style === 4 && (
        <path
          d={`M${50 - jaw} 50 Q50 6 ${50 + jaw} 50 L${50 + jaw + 3} 78 L${50 + jaw - 4} 52 Q50 30 ${54 - jaw} 52 L${47 - jaw} 78 Z`}
          fill={hair}
        />
      )}
      {style === 5 && (
        <path
          d={`M${50 - jaw + 2} 40 Q50 18 ${50 + jaw - 2} 40 Q50 30 ${50 - jaw + 2} 40 Z`}
          fill={hair}
        />
      )}
      {/* brows and eyes */}
      <path
        d={`M36 ${eyeY - 7 + brow} L45 ${eyeY - 7 - brow}`}
        stroke={hair}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d={`M55 ${eyeY - 7 - brow} L64 ${eyeY - 7 + brow}`}
        stroke={hair}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="40" cy={eyeY} r="2.6" fill={eye} />
      <circle cx="60" cy={eyeY} r="2.6" fill={eye} />
      {/* nose and mouth */}
      <path
        d={`M50 ${eyeY + 2} L47 ${eyeY + 13} L52 ${eyeY + 13}`}
        stroke="#00000033"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d={
          mouth === 1
            ? `M42 ${eyeY + 20} Q50 ${eyeY + 26} 58 ${eyeY + 20}`
            : mouth === 2
              ? `M43 ${eyeY + 21} Q50 ${eyeY + 23} 57 ${eyeY + 21}`
              : `M43 ${eyeY + 21} L57 ${eyeY + 21}`
        }
        stroke="#5a2a22"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      {facial === 0 && (
        <path
          d={`M${52 - jaw} 58 Q50 ${92} ${48 + jaw} 58 Q50 ${eyeY + 30} ${52 - jaw} 58 Z`}
          fill={hair}
          opacity="0.85"
        />
      )}
      {facial === 1 && (
        <path
          d={`M${52 - jaw} 60 Q50 ${88} ${48 + jaw} 60 Q50 ${eyeY + 32} ${52 - jaw} 60 Z`}
          fill={hair}
          opacity="0.35"
        />
      )}
      {facial === 2 && (
        <path
          d={`M42 ${eyeY + 16} Q50 ${eyeY + 12} 58 ${eyeY + 16} Q50 ${eyeY + 19} 42 ${eyeY + 16} Z`}
          fill={hair}
        />
      )}
      {scar && <path d={`M62 ${eyeY - 12} l-6 14`} stroke="#8a4b4b" strokeWidth="1.5" />}
      {lines && (
        <g stroke="#00000026" strokeWidth="1" fill="none">
          <path d={`M33 ${eyeY + 3} q-3 2 -2 5`} />
          <path d={`M67 ${eyeY + 3} q3 2 2 5`} />
          {age >= 35 && <path d="M40 30 q10 -3 20 0" />}
        </g>
      )}
    </svg>
  );
}
