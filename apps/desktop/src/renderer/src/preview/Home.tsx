import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DEADLINE_BOARD, FA_BOARD, fmtM, askFor, byId } from './mock';
import { Face, SceneImage, TeamMark, teamColors } from './graphics';
import type { LNeed, PRow } from './league';
import { F, Name, Roll } from './parts';
import { PHASES, useFacts, usePv } from './store';

/** Mock scouting copy for the matchup hero. Keyed by opponent; falls back to a generic line. */
const LAST: Record<string, string> = {
  TOR: 'Last met Jan 9 · Montréal won 4–2',
  OTT: 'Last met Dec 14 · Ottawa won 3–2 in overtime',
  FLA: 'Last met Feb 1 · Montréal won 3–1',
  BUF: 'Last met Jan 22 · Montréal won 5–2',
  BOS: 'Last met Dec 3 · Boston won 2–1',
};
const GOALIE: Record<string, string> = {
  TOR: 'Reinholt',
  CAR: 'Brannigan',
  NJD: 'Osei',
  WSH: 'Lindahl',
  NYR: 'Varga',
  PIT: 'Teller',
  CBJ: 'Rask',
  OTT: 'Daley',
  FLA: 'Pell',
  BUF: 'Brandt',
  BOS: 'Heller',
  TBL: 'Kuzma',
  DET: 'Moran',
};
const STARS: Record<string, string> = {
  TOR: 'Dahlin, 24 G',
  OTT: 'Hartley, 31 P',
  FLA: 'Ferro, 28 G',
  BUF: 'Nyman, 26 G',
  BOS: 'Roy, 33 P',
  TBL: 'Stam, 30 P',
  DET: 'Voss, 27 P',
};

export function Home() {
  const s = usePv();
  const f = useFacts();
  const { phase, resolved, go, open, resolve, sign, trade, gamePreview, setGamePreview } = s;
  const { snap, next, needs: openNeeds } = f;
  const opener = phase === 'opener';
  const label = PHASES.find((p) => p.id === phase)?.label ?? '';
  const hurt = f.players.filter((p) => p.status !== 'OK');
  const [sel, setSel] = useState(0);
  const needs = openNeeds;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const st = usePv.getState();
      if (st.drawer || st.palette || st.intro || st.result || e.metaKey || e.ctrlKey || e.altKey)
        return;
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const n = needs[Math.min(sel, needs.length - 1)];
      if (e.key === 'ArrowDown') setSel((i) => Math.min(needs.length - 1, i + 1));
      else if (e.key === 'ArrowUp') setSel((i) => Math.max(0, i - 1));
      else if (n && ['Enter', 'c', 'd'].includes(e.key)) {
        const a = needActs(n, { open, resolve, sign, trade })[['Enter', 'c', 'd'].indexOf(e.key)];
        if (a) {
          e.preventDefault();
          a.run();
        }
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const ser = f.mySeries;
  const roundLine = ser ? `Round one · Game ${ser.sa + ser.sb + 1}` : '';
  const headline =
    phase === 'deadline' ? (
      <>Deadline day</>
    ) : phase === 'fa' ? (
      <>
        Day one <i>·</i> the phone has not stopped
      </>
    ) : next ? (
      <>{phase === 'playoffs' ? roundLine : opener ? 'Opening night' : 'Tonight'}</>
    ) : (
      <>End of the preview schedule</>
    );

  return (
    <>
      {phase === 'deadline' && (
        <div className="ticker" style={{ margin: '-24px -40px 18px' }}>
          <b>Breaking</b>
          <div>
            {[...snap.wire, ...snap.wire].map((w, i) => (
              <span key={i}>
                {w.team} {w.text}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="hm">
        <div>
          <div className="hm-head">
            <div className="lbl">
              <span>{label}</span>
              <span>{f.date}</span>
            </div>
            <div className="hm-row">
              <h1 className="d hm-title">{headline}</h1>
              {phase === 'deadline' && (
                <div>
                  <div className="countdown">{snap.clock}</div>
                  <span className="lbl">until the deadline · 3 teams have called</span>
                </div>
              )}
            </div>
          </div>

          {next && phase !== 'fa' && (
            <Matchup f={f} on={gamePreview} toggle={() => setGamePreview(!gamePreview)} />
          )}

          {phase === 'playoffs' && (
            <div className="bracket" aria-label="Bracket">
              {f.series.map((x) => (
                <div className={`series ${x.me ? 'me' : ''}`} key={x.a.ab}>
                  <div className={`t ${x.sa >= x.sb ? 'lead' : ''}`}>
                    <TeamMark ab={x.a.ab} size={24} /> {x.a.ab} <i>{x.sa}</i>
                  </div>
                  <div className={`t ${x.sb > x.sa ? 'lead' : ''}`}>
                    <TeamMark ab={x.b.ab} size={24} /> {x.b.ab} <i>{x.sb}</i>
                  </div>
                  <span className="lbl">{x.me ? roundLine : `Game ${x.sa + x.sb + 1}`}</span>
                </div>
              ))}
            </div>
          )}

          {phase !== 'playoffs' && (
            <div className="hm-stats">
              <div>
                {phase === 'fa' ? (
                  <>
                    <div className="big xl">
                      <F k="roster" v={f.roster}>
                        {f.roster} / 23
                      </F>
                    </div>
                    <span className="lbl">
                      Roster spots ·{' '}
                      <F k="open" v={23 - f.roster}>
                        {23 - f.roster} open
                      </F>
                    </span>
                  </>
                ) : (
                  <>
                    <div className="big xl">
                      <F k="rec" v={`${f.rec.w}-${f.rec.l}-${f.rec.otl}`}>
                        <Roll v={f.rec.w} />–<Roll v={f.rec.l} />–<Roll v={f.rec.otl} />
                      </F>
                    </div>
                    <span className="lbl">
                      Record ·{' '}
                      <F k="pts" v={f.pts}>
                        <Roll v={f.pts} />
                      </F>{' '}
                      pts ·{' '}
                      <F k="rank" v={f.rankText}>
                        {f.rankText}
                      </F>{' '}
                      in Atlantic
                    </span>
                  </>
                )}
              </div>
              <div>
                <div className="big xl acc">
                  <F k="cap" v={f.cap}>
                    <Roll v={f.cap} fmt={fmtM} />
                  </F>
                </div>
                <span className="lbl">Cap space</span>
              </div>
              {snap.odds !== null && (
                <div>
                  <div className="big xl">{snap.odds}%</div>
                  <span className="lbl">Playoff odds</span>
                </div>
              )}
            </div>
          )}

          <div className="hm-lower">
            {phase === 'deadline' ? (
              <section>
                <div className="col-h">
                  <h2>Who is buying</h2>
                  <span className="lbl">Atlantic and neighbours</span>
                </div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th>Role</th>
                      <th>Standing</th>
                      <th>Has / needs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DEADLINE_BOARD.map((r) => (
                      <tr key={r.ab}>
                        <td>
                          <span className="tm">
                            <TeamMark ab={r.ab} size={16} />
                            {r.name}
                          </span>
                        </td>
                        <td className={r.role === 'Buyer' ? 'acc' : ''}>{r.role}</td>
                        <td>{r.gap}</td>
                        <td>{r.has}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : phase === 'fa' ? (
              <section>
                <div className="col-h">
                  <h2>Best available</h2>
                  <span className="lbl">
                    <F k="open" v={23 - f.roster}>
                      {23 - f.roster} open
                    </F>{' '}
                    roster spots · {fmtM(f.cap)} space
                  </span>
                </div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Age</th>
                      <th>OVR</th>
                      <th>Asks</th>
                      <th>Interest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FA_BOARD.slice(0, 6).map((r) => (
                      <tr key={r.name}>
                        <td>
                          {r.name} <span className="lbl">{r.pos}</span>
                        </td>
                        <td>{r.age}</td>
                        <td>{r.ovr}</td>
                        <td>{r.ask}</td>
                        <td>{r.interest}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : phase !== 'playoffs' ? (
              <section>
                <div className="col-h">
                  <h2>{f.projected ? 'Projected Atlantic' : 'Atlantic'}</h2>
                  <span className="lbl">{f.projected ? 'Last season’s pace' : 'Points'}</span>
                </div>
                <AtlTable rows={f.table} zero={f.projected} />
                <span className="lbl" style={{ display: 'block', marginTop: 8 }}>
                  Dashed line: top three make it automatically
                </span>
              </section>
            ) : null}
            <section>
              <div className="col-h">
                <h2>League wire</h2>
                <span className="lbl">From the standings and rosters</span>
              </div>
              {snap.wire.slice(0, 4).map((w) => (
                <div className="wire" key={w.id}>
                  <time>{w.at}</time>
                  <div>
                    <p>
                      <span className="tm">
                        <TeamMark ab={w.team} size={16} />
                        <b>{w.team}</b>
                      </span>{' '}
                      {w.text}
                    </p>
                    <p className="why">{w.cause}</p>
                    {w.you && (
                      <p className="you">
                        {w.you}
                        {w.go && (
                          <>
                            {' · '}
                            <button className="nm" onClick={() => go(w.go!.target)}>
                              {w.go.label}
                            </button>
                          </>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </section>
          </div>
        </div>

        <aside>
          <div className="col-h">
            <h2>{phase === 'fa' ? 'On the phone' : 'Needs you'}</h2>
            <span className="lbl">{needs.length ? `${needs.length} open` : 'Nothing open'}</span>
          </div>
          {!needs.length && (
            <p className="calm">Nothing needs you today. Press Space when you are ready.</p>
          )}
          <AnimatePresence initial={false}>
            {snap.needs.map((n) => (
              <NeedRow
                key={n.id}
                n={n}
                done={resolved[n.id] ?? (f.needs.includes(n) ? undefined : 'Done')}
                on={needs[Math.min(sel, needs.length - 1)]?.id === n.id}
                {...{ open, resolve, sign, trade }}
              />
            ))}
          </AnimatePresence>
          {phase === 'fa' && (
            <div style={{ marginTop: 24 }}>
              <div className="col-h">
                <h2>Offers out</h2>
                <span className="lbl">Stacking</span>
              </div>
              {FA_BOARD.slice(0, 3).map((x) => (
                <div className="wire" key={x.name} style={{ gridTemplateColumns: '1fr auto' }}>
                  <div>
                    <p>
                      <b>
                        {x.name}, {x.pos}
                      </b>
                    </p>
                    <p className="why">{x.interest}</p>
                  </div>
                  <b className="d acc" style={{ fontSize: 22 }}>
                    {x.ask}
                  </b>
                </div>
              ))}
            </div>
          )}
          {phase !== 'fa' && phase !== 'playoffs' && (
            <div style={{ marginTop: 24 }}>
              <div className="col-h">
                <h2>Next three</h2>
                <span className="lbl">Schedule</span>
              </div>
              {f.left.slice(0, 3).map((g) => (
                <div className="wire" key={g.date} style={{ gridTemplateColumns: '1fr auto' }}>
                  <p>
                    <span className="tm">
                      <TeamMark ab={g.ab} size={16} />
                      <b>
                        {g.home ? 'vs' : 'at'} {g.opp}
                      </b>
                    </span>
                  </p>
                  <span className="lbl">{g.when}</span>
                </div>
              ))}
              <div className="col-h" style={{ marginTop: 20 }}>
                <h2>Health</h2>
                <span className="lbl">
                  {hurt.length ? `${hurt.length} out or day to day` : 'All fit'}
                </span>
              </div>
              {hurt.map((p) => (
                <div className="wire" key={p.id} style={{ gridTemplateColumns: '1fr auto' }}>
                  <p>
                    <Name id={p.id} />
                  </p>
                  <span className="lbl acc">
                    {p.status}
                    {p.note ? ` · ${p.note}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function AtlTable({ rows, zero }: { rows: PRow[]; zero: boolean }) {
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Team</th>
          <th>GP</th>
          <th>W</th>
          <th>L</th>
          <th>OTL</th>
          <th>PTS</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 6).map((r, i) => (
          <tr key={r.ab} className={`${r.ab === 'MTL' ? 'me' : ''} ${i === 2 ? 'cut' : ''}`}>
            <td>
              <span className="tm">
                <TeamMark ab={r.ab} size={16} />
                {i + 1}. {r.name}
              </span>
            </td>
            <td>{zero ? 0 : r.gp}</td>
            <td>{zero ? 0 : r.w}</td>
            <td>{zero ? 0 : r.l}</td>
            <td>{zero ? 0 : r.otl}</td>
            <td>
              <b>
                {r.ab === 'MTL' ? (
                  <F k="pts-t" v={r.p}>
                    <Roll v={r.p} />
                  </F>
                ) : (
                  <Roll v={r.p} />
                )}
              </b>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Matchup hero: diagonal split in the two team colours, crests, records, goalie faces. Preview opens the comparison. */
function Matchup({
  f,
  on,
  toggle,
}: {
  f: ReturnType<typeof useFacts>;
  on: boolean;
  toggle: () => void;
}) {
  const g = f.next!;
  const calm = usePv((s) => s.calm);
  const opp = [...f.atl, ...f.metro].find((r) => r.ab === g.ab);
  const home = g.home ? 'MTL' : g.ab;
  const away = g.home ? g.ab : 'MTL';
  const [c1] = teamColors('MTL');
  const [c2] = teamColors(g.ab);
  const rec = (r?: PRow) => (r ? `${r.w}-${r.l}-${r.otl}` : '0-0-0');
  const mine = f.atl.find((r) => r.ab === 'MTL');
  const po = f.snap.phase === 'playoffs';
  const time = g.when.split('· ')[1] ?? g.when;
  return (
    <motion.div className="mx" style={{ '--c1': c1, '--c2': c2 } as never}>
      <SceneImage
        slot="arenaExterior"
        team={home}
        city={home === 'MTL' ? 'Montréal' : g.opp}
        time="dusk"
        dim={0.45}
      />
      <div className="mx-split" aria-hidden />
      <div className="mx-body">
        <div className="mx-side">
          <TeamMark ab="MTL" size={120} />
          <b className="d">Montréal</b>
          <span className="lbl">
            <F k="rec" v={`${f.rec.w}-${f.rec.l}-${f.rec.otl}`}>
              {rec(mine)}
            </F>
          </span>
        </div>
        <div className="mx-mid">
          <span className="lbl">
            {g.home ? 'Home' : 'Away'} · {time}
          </span>
          <div className="d mx-vs">{po ? (g.tag ?? '') : away === 'MTL' ? 'at' : 'vs'}</div>
          <span className="lbl">
            {po && f.mySeries
              ? `Series ${f.mySeries.a.ab === 'MTL' ? f.mySeries.sa : f.mySeries.sb}–${f.mySeries.a.ab === 'MTL' ? f.mySeries.sb : f.mySeries.sa}`
              : (LAST[g.ab] ?? 'First meeting this season')}
          </span>
        </div>
        <div className="mx-side r">
          <TeamMark ab={g.ab} size={120} />
          <b className="d">{g.opp}</b>
          <span className="lbl">{f.snap.stand ? rec(opp) : rec(opp)}</span>
        </div>
      </div>
      <div className="mx-foot">
        <div className="mx-g">
          <span className="mx-face">
            <Face id="fontaine" team="MTL" />
          </span>
          <span>
            <span className="lbl">Our goalie</span>
            <br />
            Fontaine
          </span>
        </div>
        <div className="mx-g r">
          <span>
            <span className="lbl">Their goalie</span>
            <br />
            {GOALIE[g.ab] ?? 'Their starter'}
          </span>
          <span className="mx-face">
            <Face id={`g-${g.ab}`} team={g.ab} />
          </span>
        </div>
        <button className="btn" onClick={toggle} aria-expanded={on}>
          {on ? 'Close preview' : 'Preview'}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {on && (
          <motion.div
            className="mx-more"
            initial={calm ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: calm ? 1 : 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          >
            <div className="mx-cmp">
              {(
                [
                  ['Record', rec(mine), rec(opp)],
                  ['Points', String(f.pts), String(opp ? opp.p : 0)],
                  ['Key player', 'Lindqvist, 24 G', STARS[g.ab] ?? '—'],
                  ['Goalie', 'Fontaine (Vuorinen day to day)', GOALIE[g.ab] ?? '—'],
                ] as const
              ).map(([k, a, b]) => (
                <div key={k}>
                  <span className="lbl">{k}</span>
                  <b>{a}</b>
                  <b>{b}</b>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface Fns {
  open: (id: string, m?: 'trade' | 'extend') => void;
  resolve: (id: string, how: string) => void;
  sign: (id: string, a: { amount: number; years: number }) => void;
  trade: (id: string) => void;
}
/** The first action is Enter, the second C, the third D. Same list drives the buttons and the keys. */
function needActs(n: LNeed, f: Fns): { label: string; run: () => void }[] {
  if (n.id === 'agent')
    return [
      { label: 'Accept $7.20M × 5', run: () => f.sign('brisebois', askFor(byId('brisebois')!)) },
      { label: 'Counter', run: () => f.open('brisebois', 'extend') },
      { label: 'Let him walk', run: () => f.resolve('agent', 'Let him test the market') },
    ];
  if (n.id === 'offer')
    return [
      { label: 'Accept', run: () => f.trade('marsh') },
      { label: 'Counter', run: () => f.open('marsh', 'trade') },
      { label: 'Decline', run: () => f.resolve('offer', 'Declined') },
    ];
  if (n.id === 'lineup')
    return [
      { label: 'Play him on line 2', run: () => f.resolve('lineup', 'Lines set') },
      { label: 'Keep the lines', run: () => f.resolve('lineup', 'Lines unchanged') },
    ];
  return [
    { label: 'Start Fontaine', run: () => f.resolve('goalie', 'Fontaine starts') },
    { label: 'Wait for warm-up', run: () => f.resolve('goalie', 'Vuorinen is a game-time call') },
  ];
}
const KEYS = ['Enter', 'C', 'D'];

function NeedRow({
  n,
  done,
  on,
  ...f
}: {
  n: LNeed;
  done: string | undefined;
  on: boolean;
} & Fns) {
  const pid = n.pid;
  const pl = byId(pid);
  const calm = usePv((x) => x.calm);
  return (
    <motion.div
      initial={calm ? false : { x: 36, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className={`need ${done ? 'done' : ''} ${on && !done ? 'on' : ''}`}
    >
      <div>
        <span className="lbl">
          {n.who} · {n.due}
        </span>
        <h3>
          {pl && n.id !== 'offer' && n.title.includes(pl.name.split(' ')[1] ?? '\0') ? (
            <>
              {n.title.slice(0, n.title.indexOf(pl.name.split(' ')[1] ?? ''))}
              <Name id={pid}>{pl.name.split(' ')[1]}</Name>
              {n.title.slice(
                n.title.indexOf(pl.name.split(' ')[1] ?? '') + (pl.name.split(' ')[1] ?? '').length,
              )}
            </>
          ) : (
            n.title
          )}
        </h3>
        <p>{n.detail}</p>
        {done ? (
          <span className="lbl acc">{done}</span>
        ) : (
          <div className="acts">
            {needActs(n, f).map((a, i) => (
              <button key={a.label} className={`btn ${i === 0 ? 'pri' : ''}`} onClick={a.run}>
                {a.label}
                {on && <span style={{ opacity: 0.55, marginLeft: 6 }}>{KEYS[i]}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
