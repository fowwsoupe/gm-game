import { useEffect, useState } from 'react';
import { BOARD_AFTER, DRAFT_RUN, MADE, PROSPECTS, TEAMS } from './mock';
import { Num, Portrait } from './parts';
import { SceneImage, TeamMark } from './graphics';
import { usePv } from './store';

const OFFERS = [
  { id: 'nyi', who: 'NY Islanders · No. 10', text: '2027 2nd + 2028 1st-round swap for No. 9' },
  { id: 'stl', who: 'St. Louis · No. 11', text: 'Their top D prospect + 2027 2nd for No. 9' },
];

export function Draft() {
  const { team, calm, say } = usePv();
  const [sel, setSel] = useState('pr5');
  const [short, setShort] = useState<string[]>(['pr5', 'pr6', 'pr7']);
  const [secs, setSecs] = useState(94);
  const [picked, setPicked] = useState<string | null>(null);
  const [rev, setRev] = useState(false);
  const [offer, setOffer] = useState<string | null>(null);
  const [run, setRun] = useState(calm ? DRAFT_RUN.length : 0);
  const [pin, setPin] = useState<string | null>(null);
  const running = run < DRAFT_RUN.length;
  const other = pin && pin !== sel ? PROSPECTS.find((x) => x.id === pin) : undefined;
  const t = TEAMS[team];
  const p = PROSPECTS.find((x) => x.id === sel) ?? PROSPECTS[4]!;
  const left = PROSPECTS.filter((x) => x.rank > 4 || x.rank < 1).filter((x) => x.id !== picked);
  const choose = (id: string | null) => {
    if (!id) return;
    setPicked(id);
    setRev(true);
  };

  useEffect(() => {
    if (!running) return;
    const i = window.setInterval(() => setRun((n) => n + 1), 1500);
    return () => window.clearInterval(i);
  }, [running]);
  useEffect(() => {
    if (picked || running) return;
    const i = window.setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(i);
  }, [picked, running]);
  useEffect(() => {
    if (secs === 0 && !picked) {
      say('Time. Best available goes in.');
      choose(short[0] ?? 'pr5');
    }
  }, [secs]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (picked || (e.target as HTMLElement).tagName === 'INPUT') return;
      if (running) {
        if ([' ', 'Escape', 'Enter'].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          setRun(DRAFT_RUN.length);
        }
        return;
      }
      if (e.key === 'x') setPin((a) => (a === sel ? null : sel));
      const i = left.findIndex((x) => x.id === sel);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel(left[Math.min(left.length - 1, i + 1)]?.id ?? sel);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel(left[Math.max(0, i - 1)]?.id ?? sel);
      } else if (e.key === 'Enter') choose(sel);
      else if (e.key === 's')
        setShort((a) => (a.includes(sel) ? a.filter((x) => x !== sel) : [...a, sel]));
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });

  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const done = picked ? PROSPECTS.find((x) => x.id === picked) : undefined;

  return (
    <div className="dr scratch">
      <SceneImage slot="draftStage" team={team} city={t.city} time="night" blur={6} dim={0.75} />
      <section aria-label="Board">
        <div className="lbl" style={{ marginBottom: 10 }}>
          Round 1 · board
        </div>
        {MADE.slice(4).map((m) => (
          <div className="pk" key={m.pick}>
            <b>{m.pick}</b>
            <span className="lbl">{m.ab}</span>
            <span>
              {m.name} <span className="lbl">{m.pos}</span>
            </span>
          </div>
        ))}
        <div className="pk me">
          <b>9</b>
          <span className="lbl acc">MTL</span>
          <span>{done ? done.name : 'On the clock'}</span>
        </div>
        {BOARD_AFTER.map((m) => (
          <div className="pk" key={m.pick}>
            <b>{m.pick}</b>
            <span className="lbl">{m.ab}</span>
            <span />
          </div>
        ))}
        <p className="mut" style={{ fontSize: 12, marginTop: 14 }}>
          Picks 1–4 went as projected: Marchand, Sjöberg, Whitfield, Orlov.
        </p>
      </section>

      <section aria-label="On the clock" style={{ textAlign: 'center' }}>
        <div className="lbl">
          Round 1 · pick 9 · <span className="acc">{t.city} is on the clock</span>
        </div>
        {secs <= 10 && !picked && !running && <div className="vig" aria-hidden />}
        {running && (
          <div className="run" onClick={() => setRun(DRAFT_RUN.length)}>
            <span className="lbl">Picks 5–8 · the board is moving</span>
            {DRAFT_RUN.slice(0, run + 1).map((l, n) => (
              <p key={n}>{l}</p>
            ))}
            <button className="btn pri" onClick={() => setRun(DRAFT_RUN.length)}>
              Skip to our pick <span style={{ opacity: 0.6, marginLeft: 6 }}>Space</span>
            </button>
          </div>
        )}
        <div className={`clock ${secs <= 10 && !picked ? 'hot' : ''} ${running ? 'wait' : ''}`}>
          {picked ? '✓' : clock}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '260px 1fr',
            gap: 28,
            textAlign: 'left',
            maxWidth: 800,
            margin: '28px auto 0',
            padding: 20,
            background: 'rgba(8,10,16,.86)',
            backdropFilter: 'blur(14px)',
            border: '1px solid var(--line-2)',
          }}
        >
          <div style={{ position: 'relative', height: 300, border: '1px solid var(--line-2)' }}>
            <Portrait num={p.num} id={p.id} showNumber={false} />
          </div>
          <div>
            <span className="lbl">
              #{p.rank} on your board · {p.pos} · {p.age} · {p.from}
            </span>
            <h2 className="d" style={{ fontSize: 64, margin: '8px 0' }}>
              {p.name}
            </h2>
            <p className="mut" style={{ fontSize: 15, margin: '0 0 14px' }}>
              {p.note}
            </p>
            <div className="lbl">Projected overall</div>
            <div className="big acc" style={{ marginBottom: 18 }}>
              {p.ovr}
            </div>
            <div className="acts">
              <button className="btn pri" onClick={() => choose(sel)}>
                Draft {p.name.split(' ')[1]}{' '}
                <span style={{ opacity: 0.6, marginLeft: 6 }}>Enter</span>
              </button>
              <button
                className="btn"
                onClick={() =>
                  setShort((a) => (a.includes(sel) ? a.filter((x) => x !== sel) : [...a, sel]))
                }
              >
                {short.includes(sel) ? 'Remove from shortlist' : 'Shortlist'}{' '}
                <span style={{ opacity: 0.5, marginLeft: 6 }}>S</span>
              </button>
              <button className="btn" onClick={() => setPin(pin === sel ? null : sel)}>
                {pin === sel ? 'Unpin' : 'Pin to compare'}{' '}
                <span style={{ opacity: 0.5, marginLeft: 6 }}>X</span>
              </button>
            </div>
          </div>
        </div>
        {other && (
          <table className="tbl cmp">
            <thead>
              <tr>
                <th />
                <th>{p.name}</th>
                <th>{other.name}</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Rank', 'rank'],
                  ['Age', 'age'],
                  ['Projected OVR', 'ovr'],
                  ['Position', 'pos'],
                  ['From', 'from'],
                ] as const
              ).map(([l, k]) => (
                <tr key={k}>
                  <td className="lbl">{l}</td>
                  <td className={k === 'ovr' && p.ovr > other.ovr ? 'acc' : ''}>{p[k]}</td>
                  <td className={k === 'ovr' && other.ovr > p.ovr ? 'acc' : ''}>{other[k]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-label="Shortlist and offers">
        <div className="col-h">
          <h2>Available</h2>
          <span className="lbl">↑ ↓ to browse</span>
        </div>
        {left.map((x) => (
          <button
            key={x.id}
            className="sl"
            aria-selected={x.id === sel}
            onClick={() => setSel(x.id)}
            onDoubleClick={() => choose(x.id)}
          >
            <Num n={x.num} />
            <span>
              {x.name} <span className="lbl">{x.pos}</span>
            </span>
            <span className={short.includes(x.id) ? 'acc' : 'lbl'}>
              {short.includes(x.id) ? `★ ${short.indexOf(x.id) + 1}` : `#${x.rank}`}
            </span>
          </button>
        ))}
        <div className="col-h" style={{ marginTop: 28 }}>
          <h2>Offers to move up</h2>
          <span className="lbl">{OFFERS.length}</span>
        </div>
        {OFFERS.map((o) => (
          <div className="need" key={o.id}>
            <div>
              <span className="lbl">{o.who}</span>
              <p style={{ margin: '4px 0 10px' }}>{o.text}</p>
              {offer === o.id ? (
                <span className="lbl acc">Countered · preview only</span>
              ) : (
                <div className="acts">
                  <button className="btn" onClick={() => setOffer(o.id)}>
                    Counter
                  </button>
                  <button className="btn" onClick={() => setOffer('x')}>
                    Pass
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </section>

      {done && rev && (
        <Reveal
          id={done.id}
          team={team}
          name={done.name}
          pos={done.pos}
          num={done.num}
          line={done.note}
          city={t.city}
          calm={calm}
          onDone={() => setRev(false)}
        />
      )}
    </div>
  );
}

function Reveal({
  id,
  team,
  name,
  pos,
  num,
  line,
  city,
  calm,
  onDone,
}: {
  id: string;
  team: string;
  name: string;
  pos: string;
  num: number;
  line: string;
  city: string;
  calm: boolean;
  onDone: () => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) =>
      ['Escape', ' ', 'Enter'].includes(e.key) && (e.stopPropagation(), onDone());
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onDone]);
  const [w1, w2] = name.split(' ');
  return (
    <div className="reveal" onClick={onDone} style={calm ? { animation: 'none' } : undefined}>
      <div>
        <span className="lbl">Round 1 · pick 9 · {city} selects</span>
        <h1>
          {w1}
          <br />
          <span className="acc">{w2}</span>
        </h1>
        <p className="mut" style={{ fontSize: 18 }}>
          {pos} · {line}
        </p>
        <span className="lbl" style={{ display: 'block', marginTop: 40 }}>
          Click, Space or Esc to continue
        </span>
      </div>
      <div className="ptr" style={{ position: 'relative' }}>
        <Portrait num={num} id={id} showNumber={false} />
        <span className="rv-mark">
          <TeamMark ab={team} size={72} />
        </span>
      </div>
    </div>
  );
}
