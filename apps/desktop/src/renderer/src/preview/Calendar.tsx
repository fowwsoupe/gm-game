import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TeamMark, teamColors } from './graphics';
import { EVENTS, type Game, type Phase } from './league';
import { Segmented } from './parts';
import { useFacts, usePv } from './store';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parse = (d: string, year: number) => {
  const m = /([A-Za-z]+) (\d+)$/.exec(d);
  return m
    ? Date.UTC(
        year,
        MONTHS.findIndex((x) => x.startsWith(m[1]!.slice(0, 3))),
        Number(m[2]),
      )
    : 0;
};
const key = (t: number) => new Date(t).toISOString().slice(0, 10);
const DAY = 86_400_000;

export function Calendar() {
  const f = useFacts();
  const { phase, game, setPhase, continueGame, go, day, setDay, say, calm } = usePv();
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [menu, setMenu] = useState<{ x: number; y: number; k: string } | null>(null);
  const year = phase === 'opener' ? 2026 : 2027;
  const games = f.snap.games.map((g, i) => ({ g, i, t: parse(g.date, year) }));
  const today = parse(f.next?.date ?? f.date, year);
  const first = new Date(today);
  const start =
    mode === 'month'
      ? Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1)
      : today - new Date(today).getUTCDay() * DAY;
  const last =
    mode === 'month'
      ? Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)
      : start + 6 * DAY;
  const lead = new Date(start).getUTCDay();
  const cells: (number | null)[] = [
    ...Array(mode === 'month' ? lead : 0).fill(null),
    ...Array.from({ length: (last - start) / DAY + 1 }, (_, i) => start + i * DAY),
  ];
  const events = EVENTS.map((e) => ({ ...e, t: e.at })).filter((e) => e.t >= start && e.t <= last);
  const simTo = (k: string) => {
    const hit = games.find((x) => key(x.t) === k);
    const ev = events.find((e) => key(e.t) === k);
    if (hit && hit.i >= game) {
      for (let n = game; n <= hit.i; n++) continueGame();
      say(`Simmed to ${hit.g.date}`);
    } else if (ev) {
      setPhase(ev.id);
      go(ev.id === 'draft' ? 'draft' : 'home');
    } else say('Nothing to sim to on that date');
    setMenu(null);
  };
  const sel = day
    ? { games: games.filter((x) => key(x.t) === day), ev: events.find((e) => key(e.t) === day) }
    : null;

  return (
    <div onClick={() => setMenu(null)}>
      <div className="ro-head">
        <div>
          <span className="lbl">
            {MONTHS[first.getUTCMonth()]} {first.getUTCFullYear()}
          </span>
          <h1>Calendar</h1>
        </div>
        <Segmented
          id="calmode"
          value={mode}
          onChange={setMode}
          options={[
            { id: 'month', label: 'Month' },
            { id: 'week', label: 'Week' },
          ]}
        />
      </div>
      <div className="cal-dow">
        {DOW.map((d) => (
          <span key={d} className="lbl">
            {d}
          </span>
        ))}
      </div>
      <div className={`cal ${mode}`}>
        {cells.map((t, i) => {
          if (t === null) return <div key={`b${i}`} className="cal-blank" />;
          const k = key(t);
          const gm = games.find((x) => key(x.t) === k);
          const ev = events.find((e) => key(e.t) === k);
          const isToday = t === today;
          const [c] = gm ? teamColors(gm.g.ab) : ['#888'];
          const played = gm && gm.i < game;
          return (
            <motion.button
              key={k}
              className={`cal-d ${isToday ? 'today' : ''} ${ev ? 'ev' : ''} ${day === k ? 'sel' : ''}`}
              onClick={() => setDay(day === k ? null : k)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, k });
              }}
              whileHover={calm ? {} : { y: -2 }}
              whileTap={calm ? {} : { scale: 0.98 }}
              style={{ '--opp': c } as never}
              aria-label={`${new Date(t).toUTCString().slice(0, 11)}${gm ? `, ${gm.g.home ? 'vs' : 'at'} ${gm.g.opp}` : ''}${ev ? `, ${ev.what}` : ''}`}
            >
              <span className="cal-n">{new Date(t).getUTCDate()}</span>
              {gm && (
                <span className={`cal-g ${played ? 'p' : ''}`}>
                  <TeamMark ab={gm.g.ab} size={mode === 'week' ? 48 : 24} />
                  <span>
                    <b>
                      {gm.g.home ? 'vs' : '@'} {gm.g.ab}
                    </b>
                    <small>
                      {played
                        ? `${gm.g.res[0] > gm.g.res[1] ? 'W' : 'L'} ${gm.g.res[0]}–${gm.g.res[1]}${gm.g.res[2] ? ' OT' : ''}`
                        : (gm.g.when.split('· ')[1] ?? '')}
                    </small>
                  </span>
                </span>
              )}
              {ev && !gm && <span className="cal-e">{ev.what.split(',')[0]}</span>}
            </motion.button>
          );
        })}
      </div>
      {events.map((e) => (
        <div className="cal-banner" key={e.id}>
          <b className="d">{e.when}</b>
          <span>{e.what}</span>
          <button className="btn" onClick={() => simTo(key(e.t))}>
            {e.verb}
          </button>
        </div>
      ))}
      <AnimatePresence>
        {day && sel && (
          <motion.div
            key={day}
            className="cal-detail"
            initial={calm ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          >
            <div className="lbl">
              {new Date(Number(Date.parse(day))).toUTCString().slice(0, 11)}
            </div>
            {sel.games.map(({ g, i }) => (
              <DayGame key={i} g={g} done={i < game} onSim={() => simTo(day)} />
            ))}
            {sel.ev && !sel.games.length && (
              <div className="cal-banner" style={{ margin: 0 }}>
                <b className="d">{sel.ev.when}</b>
                <span>{sel.ev.what}</span>
                <button className="btn pri" onClick={() => simTo(day)}>
                  {sel.ev.verb}
                </button>
              </div>
            )}
            {!sel.games.length && !sel.ev && <p className="mut">No game. Practice day.</p>}
            {Number(Date.parse(day)) === today && f.needs.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <span className="lbl">Due today</span>
                {f.needs.map((n) => (
                  <p key={n.id} style={{ margin: '6px 0' }}>
                    <b>{n.title}</b> <span className="lbl">· {n.due}</span>
                  </p>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {menu && (
        <div className="menu" style={{ left: menu.x, top: menu.y, position: 'fixed' }} role="menu">
          <button role="menuitem" onClick={() => simTo(menu.k)}>
            Sim to date
          </button>
        </div>
      )}
    </div>
  );
}

function DayGame({ g, done, onSim }: { g: Game; done: boolean; onSim: () => void }) {
  return (
    <div className="cal-card">
      <TeamMark ab="MTL" size={48} />
      <div className="d cal-vs">{g.home ? 'vs' : 'at'}</div>
      <TeamMark ab={g.ab} size={48} />
      <div>
        <b className="d" style={{ fontSize: 22 }}>
          {g.opp}
        </b>
        <span className="lbl" style={{ display: 'block' }}>
          {g.tag ? `${g.tag} · ` : ''}
          {g.when}
        </span>
        {done && (
          <p className="mut" style={{ margin: '6px 0 0' }}>
            {g.res[0] > g.res[1] ? 'Won' : 'Lost'} {g.res[0]}–{g.res[1]}
            {g.res[2] ? ' in overtime' : ''}. {g.why}
          </p>
        )}
      </div>
      {!done && (
        <button className="btn pri" onClick={onSim}>
          Sim to here
        </button>
      )}
    </div>
  );
}
export type { Phase };
