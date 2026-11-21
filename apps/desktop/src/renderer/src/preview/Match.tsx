import type { GameDetail, HockeyBoxScore } from '@gm/shared';
import { clockText } from '@/lib/format';
import { scene, type RinkGame } from '@/lib/rink';
import { Rink, useGameClock } from '@/ui/Rink';
import fixture from './match.fixture.json';
import { TEAMS, type TeamKey } from './mock';
import { usePv } from './store';

/**
 * The match view on a fixture: one game the sim played with its timeline (league seed 1, its first
 * two teams, game seed 25: 5-6, a power-play goal, the home net empty at the end). The rink is the
 * app's own component; the preview gives it its colours. The home side wears the picked team.
 */
const detail = fixture as unknown as GameDetail;
const box = detail.result.box as HockeyBoxScore;
const game: RinkGame = { box, timeline: box.timeline!, overtimeSeconds: detail.overtimeSeconds };
const END = 3600;

export function Match() {
  const { team, calm } = usePv();
  const away = (Object.keys(TEAMS) as TeamKey[]).find((k) => k !== team)!;
  const { at, clock, playing, speed, setPlaying, setSpeed, seek } = useGameClock(END, 8);
  const { score } = scene(game, clock, calm);
  const done = clock >= END;
  return (
    <section className="match" aria-label="Match view">
      <header>
        <b>{away}</b>
        <span className="score">{score[1]}</span>
        <span className="lbl">
          {done
            ? 'Final'
            : `P${Math.floor(clock / 1200) + 1} · ${clockText(clock, detail.overtimeSeconds)}`}
        </span>
        <span className="score">{score[0]}</span>
        <b>{team}</b>
      </header>
      <Rink
        game={game}
        at={at}
        colors={[TEAMS[team].text, TEAMS[away].text]}
        names={detail.names}
        calm={calm}
        label="Rink"
      />
      <footer>
        <button className="btn pri" disabled={done} onClick={() => setPlaying(!playing)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button className="btn" onClick={() => seek(0, true)}>
          Restart
        </button>
        {[1, 2, 4, 8, 20].map((s) => (
          <button key={s} className="btn" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
            {s}×
          </button>
        ))}
      </footer>
    </section>
  );
}
