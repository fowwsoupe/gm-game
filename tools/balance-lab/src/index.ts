/**
 * Balance lab: simulates many seasons with no UI and reports league health.
 * Run before and after any change to the sim's numbers, and paste both reports in the PR.
 *
 *   pnpm lab                 # 20 seasons, default seeds
 *   pnpm lab --seasons 100   # more seasons = more confidence
 *
 * Each "season" today is a fresh league from a different seed (there is no offseason
 * rollover yet). When multi-year saves exist, extend this to run one league for N years
 * and add aging, contract and dynasty checks.
 */
import type { Actor, GameResult, TeamId } from '@gm/shared';
import { computeStandings, createLeague, defaultContext, handleCommand } from '@gm/sim';

interface Check {
  name: string;
  value: number;
  /** Healthy range, from real NHL seasons (approximate; refine with real data). */
  min: number;
  max: number;
  unit?: string;
}

const args = process.argv.slice(2);
const seasons = Number(args[args.indexOf('--seasons') + 1]) || 20;
const firstSeed = Number(args[args.indexOf('--seed') + 1]) || 1;

const ctx = defaultContext();
const actor: Actor = { id: 'lab', controls: [] };
const all: GameResult[] = [];
const pointSpreads: number[] = [];
const started = performance.now();

for (let i = 0; i < seasons; i++) {
  const state = createLeague(firstSeed + i, ctx);
  const res = handleCommand(
    state,
    { kind: 'sim.advance', days: ctx.ruleset.season.calendar.regularSeasonDays },
    actor,
    ctx,
  );
  if (!res.ok) throw new Error(res.error.message);
  const results = Object.values(state.results);
  all.push(...results);
  const rows = computeStandings(
    Object.keys(state.teams) as TeamId[],
    results,
    ctx.ruleset.season.points,
  );
  pointSpreads.push(rows[0]!.pts - rows[rows.length - 1]!.pts);
}

const ms = performance.now() - started;
const games = all.length;
const goals = all.reduce((s, g) => s + g.homeGoals + g.awayGoals, 0);
const shots = all.reduce((s, g) => s + g.homeShots + g.awayShots, 0);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const checks: Check[] = [
  { name: 'Goals per team per game', value: goals / (games * 2), min: 2.8, max: 3.3 },
  { name: 'Shots per team per game', value: shots / (games * 2), min: 27, max: 33 },
  { name: 'Save percentage', value: 1 - goals / shots, min: 0.895, max: 0.91 },
  {
    name: 'Home win %',
    value: (100 * all.filter((g) => g.homeGoals > g.awayGoals).length) / games,
    min: 52,
    max: 56,
    unit: '%',
  },
  {
    name: 'Games to overtime %',
    value: (100 * all.filter((g) => g.overtime).length) / games,
    min: 20,
    max: 26,
    unit: '%',
  },
  {
    name: 'Shootout %',
    value: (100 * all.filter((g) => g.shootout).length) / games,
    min: 6,
    max: 12,
    unit: '%',
  },
  { name: 'Points gap 1st to last', value: avg(pointSpreads), min: 40, max: 70 },
];

const pad = (s: string, n: number) => s.padEnd(n);
console.log(`\nBalance lab: ${seasons} seasons, ${games} games, ${(ms / 1000).toFixed(1)}s\n`);
console.log(`${pad('Check', 28)}${pad('Value', 10)}${pad('Healthy', 16)}Result`);
let failures = 0;
for (const c of checks) {
  const ok = c.value >= c.min && c.value <= c.max;
  if (!ok) failures++;
  const fmt = (n: number) => (Math.abs(n) < 1 ? n.toFixed(3) : n.toFixed(1)) + (c.unit ?? '');
  console.log(
    `${pad(c.name, 28)}${pad(fmt(c.value), 10)}${pad(`${fmt(c.min)}–${fmt(c.max)}`, 16)}${ok ? 'ok' : 'OUT OF RANGE'}`,
  );
}
console.log(
  `\n${failures === 0 ? 'League looks healthy.' : `${failures} check(s) out of range.`}\n`,
);
