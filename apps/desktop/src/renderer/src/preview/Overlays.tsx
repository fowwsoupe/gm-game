import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  MY_EXTRAS,
  OTT_ASSETS,
  OTT_CAP_SPACE,
  ROSTER,
  askFor,
  byId,
  fmtM,
  fmtM1,
  CAP,
  worth,
  type Asset,
  type Player,
} from './mock';
import { Num, Roll, statLine } from './parts';
import { SceneImage, TeamMark } from './graphics';
import { ASSET_PLAYER, impactOf, lookup, nextYearCap } from './profile';
import { Profile } from './ProfileView';
import { SECTIONS, usePv, useFacts, type Section } from './store';

/* ---------- peek: hover preview only, never the only way to act ---------- */
export function Peek() {
  const peek = usePv((s) => s.peek);
  const pl = peek && byId(peek.id);
  if (!peek || !pl) return null;
  const left = Math.min(peek.x + 18, window.innerWidth - 320);
  const top = Math.min(peek.y + 14, window.innerHeight - 220);
  return (
    <div className="peek" style={{ left, top }}>
      <div className="h">
        <Num n={pl.num} />
        <div>
          <b>{pl.name}</b>
          <span className="lbl">
            {pl.pos} · {pl.age} · {pl.ht} · shoots {pl.shoots}
          </span>
        </div>
      </div>
      <div className="grid">
        <div>
          <b>{pl.ovr}</b>
          <span className="lbl">OVR</span>
        </div>
        <div>
          <b>{(pl.capHit / 1e6).toFixed(2)}</b>
          <span className="lbl">Cap $M</span>
        </div>
        <div>
          <b>{pl.years}</b>
          <span className="lbl">Years</span>
        </div>
        <div>
          <b className={pl.status === 'OK' ? '' : 'acc'}>{pl.status}</b>
          <span className="lbl">Status</span>
        </div>
      </div>
      <div className="mut" style={{ fontSize: 12 }}>
        {statLine(pl)}
        {pl.note ? ` · ${pl.note}` : ''}
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        Click to open · right-click for actions
      </div>
    </div>
  );
}

/* ---------- context menu: the same actions, reachable by pointer ---------- */
export function Menu() {
  const { menu, open, setMenu } = usePv();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), [menu]);
  if (!menu) return null;
  const items: [string, string, () => void][] = [
    ['Open profile', 'Enter', () => open(menu.id)],
    ['Propose trade', 'T', () => open(menu.id, 'trade')],
    ['Extend contract', 'E', () => open(menu.id, 'extend')],
  ];
  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 79 }}
        onClick={() => setMenu(null)}
        onContextMenu={(e) => (e.preventDefault(), setMenu(null))}
      />
      <div
        className="menu"
        role="menu"
        style={{
          left: Math.min(menu.x, window.innerWidth - 230),
          top: Math.min(menu.y, window.innerHeight - 140),
        }}
      >
        {items.map(([l, k, f], i) => (
          <button key={l} role="menuitem" ref={i === 0 ? first : undefined} onClick={f}>
            {l}
            <kbd>{k}</kbd>
          </button>
        ))}
      </div>
    </>
  );
}

/* ---------- drawer: player detail without leaving the screen ---------- */
export function Drawer() {
  const { drawer, mode, close, open } = usePv();
  const pl = drawer ? lookup(drawer) : undefined;
  if (!pl) return null;
  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="drawer" role="dialog" aria-label={pl.name}>
        {mode === 'profile' && <Profile pl={pl} open={open} close={close} />}
        {mode === 'extend' && <Extend pl={pl} />}
        {mode === 'trade' && <Trade pl={pl} />}
      </aside>
    </>
  );
}

function Extend({ pl }: { pl: Player }) {
  const ask = askFor(pl);
  const sign = usePv((s) => s.sign);
  const open = usePv((s) => s.open);
  const [amt, setAmt] = useState(ask.amount);
  const [yrs, setYrs] = useState(ask.years);
  const ratio = amt / ask.amount - (yrs < ask.years ? 0.04 : 0);
  const word = ratio >= 0.995 ? 'Signs' : ratio >= 0.93 ? 'Close' : 'Walks';
  return (
    <div className="dr-body sheet">
      <span className="lbl">Contract talks · agent Dana Kessler</span>
      <h3 style={{ marginTop: 8, fontSize: 44 }}>{pl.name}</h3>
      <div className="row">
        <span>He asks</span>
        <b>
          {fmtM(ask.amount)} × {ask.years}
        </b>
      </div>
      <div className="row">
        <span>Now</span>
        <b>
          {fmtM(pl.capHit)} × {pl.years}
        </b>
      </div>
      <div className="row">
        <span>Your offer</span>
        <span className="acts">
          <button className="btn" onClick={() => setAmt(amt - 250_000)}>
            −0.25
          </button>
          <b className="big" style={{ fontSize: 30 }}>
            {fmtM(amt)}
          </b>
          <button className="btn" onClick={() => setAmt(amt + 250_000)}>
            +0.25
          </button>
        </span>
      </div>
      <div className="row">
        <span>Years</span>
        <span className="acts">
          <button className="btn" onClick={() => setYrs(Math.max(1, yrs - 1))}>
            −
          </button>
          <b className="big" style={{ fontSize: 30 }}>
            {yrs}
          </b>
          <button className="btn" onClick={() => setYrs(Math.min(8, yrs + 1))}>
            +
          </button>
        </span>
      </div>
      <div className={`verdict ${word === 'Signs' ? 'acc' : ''}`}>
        {word === 'Signs'
          ? 'He will sign'
          : word === 'Close'
            ? 'Close. Wants a little more'
            : 'He walks'}
      </div>
      <div className="acts">
        <button
          autoFocus
          className="btn pri"
          onClick={() => sign(pl.id, { amount: amt, years: yrs })}
        >
          Offer {fmtM(amt)} × {yrs}
        </button>
        <button className="btn" onClick={() => open(pl.id)}>
          Back
        </button>
      </div>
    </div>
  );
}

function Trade({ pl }: { pl: Player }) {
  const { trade, open, traded } = usePv();
  const [get, setGet] = useState<string[]>(pl.id === 'marsh' ? ['o1', 'o4'] : []);
  const [give, setGive] = useState<string[]>([]);
  const flip = (a: string[], id: string) =>
    a.includes(id) ? a.filter((x) => x !== id) : [...a, id];
  const mine = MY_EXTRAS.filter((x) => !traded.includes(x.player ?? ''));
  const gets = OTT_ASSETS.filter((x) => get.includes(x.id));
  const gives = mine.filter((x) => give.includes(x.id));
  const sendV = worth(pl) + gives.reduce((n, x) => n + x.value, 0);
  const getV = gets.reduce((n, x) => n + x.value, 0);
  const sendCap = pl.capHit + gives.reduce((n, x) => n + x.cap, 0);
  const getCap = gets.reduce((n, x) => n + x.cap, 0);
  const f = useFacts();
  const space = f.cap;
  const after = space + sendCap - getCap;
  const incoming = gets.flatMap((x) => {
    const q = ASSET_PLAYER[x.id] ? lookup(ASSET_PLAYER[x.id]!) : undefined;
    return q ? [q] : [];
  });
  const sendNext = nextYearCap(pl) + gives.reduce((n, x) => n + (x.player ? x.cap : 0), 0);
  const nextBase = CAP - f.players.reduce((n, q) => n + nextYearCap(q), 0);
  const nextAfter = nextBase + sendNext - getCap;
  const imp = impactOf(pl, f.players, incoming);
  const ottRoom = OTT_CAP_SPACE - (sendCap - getCap);
  const ratio = getV ? sendV / getV : 2;
  const blocked = pl.nmc
    ? 'No-movement clause. He has to approve this first.'
    : ottRoom < 0
      ? 'Ottawa cannot fit the cap. Take back salary.'
      : !gets.length
        ? 'Ask for something.'
        : '';
  const word = ratio >= 1.05 ? 'Ottawa accepts' : ratio >= 0.9 ? 'Close' : 'Insulting';
  const fairWord =
    ratio >= 1.4
      ? 'You overpay'
      : ratio >= 1.05
        ? 'Fair value'
        : ratio >= 0.9
          ? 'Close to fair'
          : 'Ottawa says no';
  const capDelta = sendCap - getCap;
  const headline = `${fairWord}, ${capDelta >= 0 ? 'frees' : 'adds'} ${fmtM1(Math.abs(capDelta))}${
    imp.thin ? `, leaves you thin at ${imp.thin}` : ''
  }`;
  const voice =
    ratio >= 1.05
      ? 'Lacasse: “Deal. Pleasure doing business.”'
      : ratio >= 0.9
        ? 'Lacasse: “We are close. Add a second-rounder and I can sell it upstairs.”'
        : 'Lacasse: “You are asking for the building. Try again.”';
  const chip = (x: Asset, on: boolean, f: () => void) => (
    <button key={x.id} className="chip" aria-pressed={on} onClick={f}>
      <span>
        {x.label}
        <small>{x.sub}</small>
      </span>
      <b>{x.value}</b>
    </button>
  );
  return (
    <div className="dr-body sheet">
      <span className="lbl">Trade table · {pl.name} · Ottawa (GM Pierre Lacasse, fair)</span>
      <h3 className="tv-head" data-ok={!blocked && ratio >= 1.05 ? 1 : 0}>
        {blocked || headline}
      </h3>
      <div className="tv">
        <div>
          <span className="lbl">Cap now</span>
          <b>
            {fmtM(space)} <i>→</i> <Roll v={after} fmt={fmtM} />
          </b>
        </div>
        <div>
          <span className="lbl">Cap next season</span>
          <b>
            {fmtM(nextBase)} <i>→</i> <Roll v={nextAfter} fmt={fmtM} />
          </b>
        </div>
        <div>
          <span className="lbl">Lines</span>
          {imp.lineDelta && (
            <b>
              {imp.lineDelta.line} {imp.lineDelta.from} <i>→</i> {imp.lineDelta.to}
            </b>
          )}
          <small>{imp.moves.join(' · ') || 'No lines change'}</small>
        </div>
      </div>
      {incoming.length > 0 && (
        <div className="tv-scout">
          {incoming.map((q) => (
            <button key={q.id} className="nm" onClick={() => open(q.id)}>
              Scout report: {q.name}
            </button>
          ))}
        </div>
      )}
      <div className="two">
        <div>
          <span className="lbl">You send · value {sendV}</span>
          <div className="chip" aria-pressed="true" style={{ pointerEvents: 'none' }}>
            <span>
              {pl.name}
              <small>{fmtM(pl.capHit)}</small>
            </span>
            <b>{worth(pl)}</b>
          </div>
          {mine.map((x) => chip(x, give.includes(x.id), () => setGive(flip(give, x.id))))}
        </div>
        <div>
          <span className="lbl">You get · value {getV}</span>
          {OTT_ASSETS.map((x) => chip(x, get.includes(x.id), () => setGet(flip(get, x.id))))}
        </div>
      </div>
      <div className="meter" aria-hidden>
        <i style={{ width: `${Math.min(100, (ratio / 1.6) * 100)}%` }} />
        <u />
      </div>
      <div className="row">
        <span>Your cap space after</span>
        <b>
          <Roll v={after} fmt={fmtM} />
        </b>
      </div>
      <div className="row">
        <span>Ottawa cap room after</span>
        <b>{fmtM(Math.max(0, ottRoom))}</b>
      </div>
      <div className={`verdict ${!blocked && ratio >= 1.05 ? 'acc' : ''}`}>{blocked || word}</div>
      {!blocked && (
        <p className="mut" style={{ margin: '0 0 14px' }}>
          {voice}
        </p>
      )}
      <div className="acts">
        <button
          autoFocus
          className="btn pri"
          disabled={!!blocked || ratio < 1.05}
          onClick={() =>
            trade(
              pl.id,
              gives.flatMap((x) => (x.player ? [x.player] : [])),
              getCap,
            )
          }
        >
          Propose <span style={{ opacity: 0.6, marginLeft: 6 }}>Enter</span>
        </button>
        <button className="btn" onClick={() => open(pl.id)}>
          Back
        </button>
      </div>
    </div>
  );
}

/* ---------- command palette ---------- */
interface Item {
  label: string;
  kind: string;
  group: string;
  keys: string;
  run: () => void;
}
export function Palette() {
  const { palette, setPalette, open, go, setPhase } = usePv();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const traded = usePv((s) => s.traded);
  const items = useMemo<Item[]>(() => {
    const live = ROSTER.filter((p) => !traded.includes(p.id));
    const out: Item[] = [];
    for (const p of live) {
      out.push({
        label: p.name,
        kind: `${p.pos} · #${p.num}`,
        group: 'Players',
        keys: `${p.name} ${p.pos} ${p.num}`,
        run: () => open(p.id),
      });
      out.push({
        label: `Trade ${p.name}`,
        kind: 'Action',
        group: 'Actions',
        keys: `trade ${p.name}`,
        run: () => open(p.id, 'trade'),
      });
      out.push({
        label: `Extend ${p.name}`,
        kind: 'Action',
        group: 'Actions',
        keys: `extend contract ${p.name}`,
        run: () => open(p.id, 'extend'),
      });
    }
    const jump = (label: string, s: Section, keys: string) =>
      out.push({ label, kind: 'Go to', group: 'Go to', keys, run: () => go(s) });
    SECTIONS.forEach((s) => jump(s.label, s.id, s.label));
    jump('Lines', 'roster', 'lines pairings deployment');
    jump('Cap', 'roster', 'cap space payroll');
    jump('Standings', 'home', 'standings table points');
    jump('Draft board', 'draft', 'draft board clock pick');
    out.push({
      label: 'Phase: Trade deadline',
      kind: 'Dev',
      group: 'Dev',
      keys: 'phase deadline',
      run: () => setPhase('deadline'),
    });
    return out;
  }, [traded, open, go, setPhase]);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = items.filter((it) => words.every((w) => it.keys.toLowerCase().includes(w)));
    const sug = ['Extend Noah Brisebois', 'Trade Calvin Marsh'];
    if (q) return hit.slice(0, 9);
    const top = sug
      .flatMap((l) => items.filter((it) => it.label === l))
      .map((it) => ({ ...it, group: 'Suggested' }));
    return [...top, ...items.filter((it) => SECTIONS.some((x) => x.label === it.label))].slice(
      0,
      9,
    );
  }, [q, items]);
  useEffect(() => setI(0), [q]);
  if (!palette) return null;
  const pick = (it: Item | undefined) => {
    if (!it) return;
    setPalette(false);
    setQ('');
    it.run();
  };
  return (
    <div
      className="pal-wrap"
      onMouseDown={(e) => e.target === e.currentTarget && setPalette(false)}
    >
      <div className="pal" role="dialog" aria-label="Command palette">
        <input
          autoFocus
          placeholder="Player, “trade”, “lines”, “cap”…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setI((n) => Math.min(shown.length - 1, n + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setI((n) => Math.max(0, n - 1));
            } else if (e.key === 'Enter') pick(shown[i]);
            else if (e.key === 'Escape') setPalette(false);
          }}
        />
        <ul>
          {shown.map((it, n) => (
            <Fragment key={it.label + it.kind + it.group}>
              {shown[n - 1]?.group !== it.group && <li className="grp">{it.group}</li>}
              <li aria-selected={n === i} onMouseEnter={() => setI(n)} onClick={() => pick(it)}>
                {it.label}
                <small>{it.kind}</small>
              </li>
            </Fragment>
          ))}
          {!shown.length && <li className="mut">Nothing matches “{q}”.</li>}
        </ul>
      </div>
    </div>
  );
}

export function Toast() {
  const { toast, say } = usePv();
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => say(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast, say]);
  return toast ? <div className="toast">{toast}</div> : null;
}

const CARD: Record<string, [string, string, string, string]> = {
  opener: [
    'New season',
    'Opening night',
    '2026–27',
    'Toronto at the Bell Centre. Lindqvist is healthy. Vuorinen is day to day.',
  ],
  deadline: [
    'Deadline day',
    'Breaking · 3:00 PM',
    'Three calls waiting',
    'Boston and Detroit are selling. Ottawa wants a first. You have $1.9M in space.',
  ],
  fa: [
    'July 1',
    'Noon Eastern',
    'Free agency opens',
    'Brisebois is open to every team. $9.2M of cap room. 31 free agents worth a call.',
  ],
  playoffs: [
    'Round one',
    'Game 5 at Florida',
    'Series tied 2–2',
    'Montréal is in. Sixteen teams. One cup.',
  ],
};
export function Intro() {
  const { intro, endIntro } = usePv();
  useEffect(() => {
    if (!intro) return;
    const t = window.setTimeout(endIntro, 2400);
    return () => window.clearTimeout(t);
  }, [intro, endIntro]);
  const c = intro && CARD[intro];
  if (!intro || !c) return null;
  return (
    <div className="intro" data-p={intro} onClick={endIntro}>
      <div style={{ textAlign: 'center' }}>
        <p className="lbl" style={{ color: 'inherit', opacity: 0.6 }}>
          {c[1]}
        </p>
        <h1>{c[0]}</h1>
        <i className="bar" />
        <p className="sub">{c[2]}</p>
        <p className="ctx">{c[3]}</p>
      </div>
      <span className="skip">Click, Space or Esc to skip</span>
    </div>
  );
}

/* ---------- game-day result card ---------- */
export function Result() {
  const { result, clearResult } = usePv();
  useEffect(() => {
    if (!result) return;
    const t = window.setTimeout(clearResult, 3600);
    return () => window.clearTimeout(t);
  }, [result, clearResult]);
  if (!result) return null;
  const won = result.mine > result.theirs;
  const tag = won ? 'Win' : result.ot ? 'Overtime loss' : 'Loss';
  return (
    <div className="result" data-w={won ? 1 : 0} onClick={clearResult}>
      <SceneImage
        slot="arenaInterior"
        team={result.home ? 'MTL' : result.ab}
        time="night"
        blur={8}
        dim={0.8}
      />
      <div className="result-in">
        <span className="lbl">
          {result.home ? 'vs' : 'at'} {result.opp} · {tag}
          {result.ot ? ' · OT' : ''}
        </span>
        <div className="score">
          <TeamMark ab="MTL" size={96} />
          <span>{result.mine}</span>
          <i aria-label="to">–</i>
          <span>{result.theirs}</span>
          <TeamMark ab={result.ab} size={96} />
        </div>
        <p className="why">{result.why}</p>
        <div className="stars">
          {result.stars.map((x, n) => (
            <span key={x}>
              <b>{'★'.repeat(3 - n)}</b> {x}
            </span>
          ))}
        </div>
        <span className="lbl" style={{ display: 'block', marginTop: 22 }}>
          {result.next} · Space for the next game · click to close
        </span>
      </div>
    </div>
  );
}
