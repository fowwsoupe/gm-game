// UI preview at #/preview. An isolated design prototype: its own components, mock data and CSS.
// Deliberate exception to "strings in i18n, screens from ui/ components": this is not a shipping screen.
// It never touches window.gm, the sim, or the database.
import { useEffect, useRef, useState } from 'react';
import { MotionConfig, motion } from 'framer-motion';
import './preview.css';
import { Draft } from './Draft';
import { Home } from './Home';
import { Drawer, Intro, Menu, Palette, Peek, Result, Toast } from './Overlays';
import { Calendar } from './Calendar';
import { League, Market, Scout } from './Others';
import { checkDom } from './league';
import { F } from './parts';
import { Roster } from './Roster';
import { SceneImage, type SceneSlot } from './graphics';
import { TEAMS, type TeamKey } from './mock';
import { PHASES, SECTIONS, useFacts, usePv } from './store';
import { cue } from './sound';

// Full-bleed art behind every screen: a placeholder-art image when present, else a dark textured frame.
const SCENE: Record<string, SceneSlot> = {
  home: 'arenaExterior',
  roster: 'trainingCamp',
  market: 'warRoom',
  scout: 'warRoom',
  league: 'awardsGala',
  calendar: 'roadTrip',
  fa: 'warRoom',
};

export default function PreviewApp() {
  const s = usePv();
  const { phase, section, team, calm, sound, go, setPalette, continueGame, close } = s;
  const t = TEAMS[team];
  const f = useFacts();
  const next = f.next;
  const root = useRef<HTMLDivElement>(null);
  // Fixed 1920x1080 canvas, scaled to fit the window; letterboxed, never scrolls.
  const [k, setK] = useState(() => Math.min(innerWidth / 1920, innerHeight / 1080));
  useEffect(() => {
    const fit = () => setK(Math.min(innerWidth / 1920, innerHeight / 1080));
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);
  useEffect(() => {
    // Dev check: every screen showing the same fact must agree. Throws if not.
    const id = requestAnimationFrame(() => checkDom(root.current));
    return () => cancelAnimationFrame(id);
  });

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).tagName === 'INPUT';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        return setPalette(!usePv.getState().palette);
      }
      if (e.key === 'Escape') {
        if (usePv.getState().intro) return usePv.getState().endIntro();
        return close();
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (usePv.getState().intro) return usePv.getState().endIntro();
      if (usePv.getState().palette) return;
      if (usePv.getState().result && e.key !== ' ') return usePv.getState().clearResult();
      const n = Number(e.key);
      if (n >= 1 && n <= 6) go(SECTIONS[n - 1]!.id);
      else if (e.key === ' ' && usePv.getState().section !== 'draft') {
        e.preventDefault();
        usePv.getState().clearResult();
        continueGame();
        cue('horn');
      } else if (e.key === '/') {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [go, setPalette, continueGame, close]);

  const label =
    phase === 'draft'
      ? 'Skip to our pick'
      : phase === 'fa'
        ? 'Next day'
        : next
          ? `Sim ${next.home ? 'vs' : 'at'} ${next.opp}`
          : 'Season done';

  return (
    <MotionConfig reducedMotion={calm ? 'always' : 'user'}>
      <div className="pv-stage">
        <div
          ref={root}
          className="pv"
          data-phase={phase}
          data-calm={calm ? '1' : '0'}
          style={
            {
              '--team': t.fill,
              '--team-text': t.text,
              transform: `translate(-50%, -50%) scale(${k})`,
            } as React.CSSProperties
          }
        >
          <header className="pv-bar">
            <div className="pv-id">
              <b>{t.city}</b>
              <span>
                {f.snap.offseason ? (
                  '2026–27 offseason'
                ) : (
                  <>
                    2026–27 · <F k="rec" v={`${f.rec.w}-${f.rec.l}-${f.rec.otl}`} /> ·{' '}
                    <F k="pts" v={f.pts}>
                      {f.pts} pts
                    </F>
                  </>
                )}
              </span>
            </div>
            <nav className="pv-nav" aria-label="Sections">
              {SECTIONS.map((x, i) => (
                <button
                  key={x.id}
                  aria-current={section === x.id ? 'page' : undefined}
                  onClick={() => go(x.id)}
                >
                  {section === x.id && (
                    <motion.span
                      layoutId="nav-ind"
                      className="nav-ind"
                      transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                    />
                  )}
                  <span className="nav-l">{x.label}</span>
                  <kbd>{i + 1}</kbd>
                </button>
              ))}
            </nav>
            <button className="pv-search" onClick={() => setPalette(true)}>
              Search players, actions <kbd style={{ font: '500 11px var(--b)' }}>⌘K</kbd>
            </button>
            <button
              className="pv-go"
              onClick={() => {
                continueGame();
                cue('horn');
              }}
            >
              {label}
              <small>Space</small>
            </button>
          </header>

          <main className="pv-main">
            {SCENE[section] && <SceneImage slot={SCENE[section]} team={team} blur={10} dim={0.7} />}
            <motion.div
              className="pv-screen"
              key={section}
              initial={calm ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
            >
              {section === 'draft' ? (
                <Draft />
              ) : (
                <div className="pv-wrap">
                  {section === 'home' ? (
                    <Home />
                  ) : section === 'roster' ? (
                    <Roster />
                  ) : section === 'market' ? (
                    <Market />
                  ) : section === 'scout' ? (
                    <Scout />
                  ) : section === 'league' ? (
                    <League />
                  ) : (
                    <Calendar />
                  )}
                </div>
              )}
            </motion.div>
            <Drawer />
            <Intro />
            <Result />
            <Toast />
            <Palette />
            <div className="pv-dev" role="toolbar" aria-label="Preview controls">
              <span>Phase</span>
              {PHASES.map((p) => (
                <button key={p.id} aria-pressed={phase === p.id} onClick={() => s.setPhase(p.id)}>
                  {p.label}
                </button>
              ))}
              <span style={{ marginLeft: 16 }}>Team</span>
              {(Object.keys(TEAMS) as TeamKey[]).map((k) => (
                <button key={k} aria-pressed={team === k} onClick={() => s.setTeam(k)}>
                  {k}
                </button>
              ))}
              <span style={{ marginLeft: 16 }}>Rating</span>
              <button aria-pressed={s.ovr} onClick={s.toggleOvr}>
                {s.ovr ? 'OVR' : 'Role fit'}
              </button>
              <span style={{ marginLeft: 16 }}>Motion</span>
              <button aria-pressed={calm} onClick={s.toggleCalm}>
                Reduced
              </button>
              <span>Sound</span>
              <button aria-pressed={sound} onClick={s.toggleSound}>
                {sound ? 'On' : 'Muted'}
              </button>
              <button style={{ marginLeft: 'auto' }} onClick={s.replayIntro}>
                Replay intro
              </button>
            </div>
          </main>
          <Peek />
          <Menu />
        </div>
      </div>
    </MotionConfig>
  );
}
