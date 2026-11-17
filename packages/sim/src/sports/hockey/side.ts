import type { HockeyGoalieLine, HockeySkaterLine, Player } from '@gm/shared';
import { attack, defence, faceoffs, rating, type TeamStrength } from './strength';

export interface Side {
  players: Player[];
  skaters: HockeySkaterLine[];
  /** Skater indexes of each forward line and defence pair. */
  lines: number[][];
  pairs: number[][];
  /** Penalty killers, two forwards per unit. */
  killers: number[][];
  /** The GM's saved power-play / penalty-kill units by unit number: skater indexes, forwards then defence. */
  saved: {
    pp: ({ f: number[]; d: number[] } | undefined)[];
    pk: ({ f: number[]; d: number[] } | undefined)[];
  };
  isD: boolean[];
  /** Per-skater skills, by index. */
  atk: number[];
  def: number[];
  draw: number[];
  shoot: number[];
  pass: number[];
  phys: number[];
  /** The goalie who started and the one who can come in, and who is in now (-1 = nobody). */
  goalies: Player[];
  current: number;
  goalieLines: HockeyGoalieLine[];
  /** Goals the current goalie has let in. */
  against: number;
  /** Skaters who left the game hurt. */
  out: Set<number>;
  onIce: number[];
  /** Penalties running, soonest to end first: [end second, skater index]. */
  penalties: [number, number][];
  pulled: boolean;
  /** Team skills of the units on ice. */
  uAtk: number;
  uDef: number;
  /** Chemistry bonus added to every unit (rating points). */
  chem: number;
}

export function makeSide(strength: TeamStrength, backup: boolean): Side {
  const { forwards, defense, goalies } = strength.lineup;
  const players: Player[] = [];
  const index = (unit: Player[]) => unit.map((p) => players.push(p) - 1);
  const lines = forwards.map(index);
  const pairs = defense.map(index);
  const killers = lines
    .flat()
    .sort((a, b) => rating(players[b]!, 'defense') - rating(players[a]!, 'defense') || a - b)
    .slice(0, 4);
  const at = new Map(players.map((p, k) => [p.id, k]));
  const unit = (name: 'pp1' | 'pp2' | 'pk1' | 'pk2') => {
    const ks = strength.lineup.special?.[name]?.map((p) => at.get(p.id)!);
    return (
      ks && {
        f: ks.filter((k) => !pairs.flat().includes(k)),
        d: ks.filter((k) => pairs.flat().includes(k)),
      }
    );
  };
  const start = backup && goalies.length > 1 ? 1 : 0;
  const order = goalies[start] ? [goalies[start]!, ...goalies.filter((_, i) => i !== start)] : [];
  const starter = order[0];
  return {
    players,
    lines,
    pairs,
    killers: [killers.slice(0, 2), killers.slice(2)],
    saved: { pp: [unit('pp1'), unit('pp2')], pk: [unit('pk1'), unit('pk2')] },
    isD: players.map((_, k) => pairs.some((pr) => pr.includes(k))),
    atk: players.map(attack),
    def: players.map(defence),
    draw: players.map(faceoffs),
    shoot: players.map((p) => rating(p, 'shooting')),
    pass: players.map((p) => rating(p, 'passing')),
    phys: players.map((p) => rating(p, 'physical')),
    goalies: order.slice(0, 2),
    current: starter ? 0 : -1,
    goalieLines: starter ? [{ id: starter.id, toi: 0, shotsAgainst: 0, saves: 0 }] : [],
    against: 0,
    out: new Set(),
    onIce: [],
    penalties: [],
    pulled: false,
    uAtk: 50,
    uDef: 50,
    chem: strength.chemistry ?? 0,
    skaters: players.map((p) => ({
      id: p.id,
      toi: 0,
      ppToi: 0,
      pkToi: 0,
      shots: 0,
      goals: 0,
      ppGoals: 0,
      assists: 0,
      plusMinus: 0,
      pim: 0,
    })),
  };
}
