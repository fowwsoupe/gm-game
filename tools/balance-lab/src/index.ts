/**
 * Balance lab: simulates many seasons with no UI and reports league health.
 * Checks below are for hockey (NHL); each sport will get its own set of healthy ranges.
 * Run before and after any change to the sim's numbers, and paste both reports in the PR.
 *
 *   pnpm lab                 # 20 seasons, default seeds
 *   pnpm lab --seasons 100   # more seasons = more confidence
 *   pnpm lab --leagues 10 --years 30   # multi-year section: leagues x years
 *
 * Single-season checks: each "season" is a fresh league from a different seed.
 * Multi-year checks: each league plays `years` seasons in a row with the offseason rollover
 * (aging, retirements, draft, free agency) between them.
 */
import type { Actor, GameResult, TeamId } from '@gm/shared';
import {
  computeStandings,
  createLeague,
  defaultContext,
  handleCommand,
  overall,
  playoffCapBreaches,
  rulesGoalModel,
  teamStrength,
  type LeagueState,
} from '@gm/sim';

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
const leagues = Number(args[args.indexOf('--leagues') + 1]) || 5;
const years = Number(args[args.indexOf('--years') + 1]) || 20;

const ctx = defaultContext();
const actor: Actor = { id: 'lab', controls: [] };
const all: GameResult[] = [];
const pointSpreads: number[] = [];
let betterTeamSeriesWins = 0;
let measuredSeries = 0;
const started = performance.now();

for (let i = 0; i < seasons; i++) {
  const state = createLeague(firstSeed + i, ctx);
  const res = handleCommand(
    state,
    {
      kind: 'sim.advance',
      days: ctx.ruleset.season.calendar.regularSeasonDays + ctx.ruleset.season.calendar.playoffDays,
    },
    actor,
    ctx,
  );
  if (!res.ok) throw new Error(res.error.message);
  const results = Object.values(state.results).filter((g) => !g.playoffSeriesId);
  all.push(...results);
  const strengths = new Map(
    Object.keys(state.teams).map((id) => [
      id,
      teamStrength(Object.values(state.players).filter((p) => p.teamId === id)),
    ]),
  );
  for (const series of Object.values(state.playoffSeries)) {
    if (!series.winnerTeamId) continue;
    const high = strengths.get(series.higherTeamId)!;
    const low = strengths.get(series.lowerTeamId)!;
    const forward = rulesGoalModel.expectedGoals(high, low);
    const reverse = rulesGoalModel.expectedGoals(low, high);
    const highEdge = forward.home - forward.away + (reverse.away - reverse.home);
    const better = highEdge >= 0 ? series.higherTeamId : series.lowerTeamId;
    measuredSeries++;
    if (series.winnerTeamId === better) betterTeamSeriesWins++;
  }
  const rows = computeStandings(
    Object.keys(state.teams) as TeamId[],
    results,
    ctx.ruleset.season.points,
  );
  pointSpreads.push(rows[0]!.pts - rows[rows.length - 1]!.pts);
}

// ---------- multi-year: one league played for `years` seasons, with the offseason in between ----------
const rosterOf = (state: LeagueState, id: string) =>
  Object.values(state.players).filter((p) => p.teamId === id);
const meanOverall = (state: LeagueState) => {
  const rostered = Object.values(state.players).filter((p) => p.teamId !== null);
  return rostered.reduce((s, p) => s + overall(p), 0) / rostered.length;
};
const cal = ctx.ruleset.season.calendar;
let maxDrift = 0;
let maxTitles = 0;
let payrollShare = 0;
let payrollSamples = 0;
let teamsOverCap = 0;
let teamsUnderMinimum = 0;
let teamsOverPlayoffCap = 0;
let maxPool = 0;
for (let l = 0; l < leagues; l++) {
  const state = createLeague(firstSeed + l, ctx);
  const startRating = meanOverall(state);
  const titles = new Map<TeamId, number>();
  for (let y = 0; y < years; y++) {
    const played = handleCommand(
      state,
      { kind: 'sim.advance', days: cal.regularSeasonDays + cal.playoffDays },
      actor,
      ctx,
    );
    if (!played.ok) throw new Error(played.error.message);
    titles.set(state.championTeamId!, (titles.get(state.championTeamId!) ?? 0) + 1);
    const rolled = handleCommand(state, { kind: 'season.rollover' }, actor, ctx);
    if (!rolled.ok) throw new Error(rolled.error.message);
    teamsOverPlayoffCap += playoffCapBreaches(Object.values(state.players), ctx.ruleset).length;
    maxDrift = Math.max(maxDrift, Math.abs(meanOverall(state) - startRating));
    for (const id of Object.keys(state.teams)) {
      const roster = rosterOf(state, id);
      const payroll = roster.reduce((s, p) => s + (p.contract?.capHit ?? 0), 0);
      payrollShare += payroll / ctx.ruleset.cap.upperLimit;
      payrollSamples++;
      if (payroll > ctx.ruleset.cap.upperLimit) teamsOverCap++;
      const short = Object.entries(ctx.ruleset.roster.positionMin).some(
        ([pos, min]) => roster.filter((p) => p.position === pos).length < min,
      );
      if (short || roster.length < ctx.ruleset.roster.minActive) teamsUnderMinimum++;
    }
  }
  maxTitles = Math.max(maxTitles, ...titles.values());
  maxPool = Math.max(maxPool, Object.values(state.players).filter((p) => p.teamId === null).length);
}

const ms = performance.now() - started;
const games = all.length;
const goals = all.reduce((s, g) => s + g.homeScore + g.awayScore, 0);
const shots = all.reduce((s, g) => s + (g.stats.homeShots ?? 0) + (g.stats.awayShots ?? 0), 0);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Targets from docs/research/2026-11-sports-gm-research.md (Hockey-Reference 2024-25 to 2026-27).
// Ranges marked "unverified" are estimates not yet backed by the research; replace when sourced.
const checks: Check[] = [
  { name: 'Goals per team per game', value: goals / (games * 2), min: 3.0, max: 3.15 },
  { name: 'Shots per team per game', value: shots / (games * 2), min: 27, max: 28.5 },
  { name: 'Save percentage', value: 1 - goals / shots, min: 0.89, max: 0.9 },
  {
    name: 'Home win % (unverified)',
    value: (100 * all.filter((g) => g.homeScore > g.awayScore).length) / games,
    min: 52,
    max: 56,
    unit: '%',
  },
  {
    name: 'Games to OT % (unverified)',
    value: (100 * all.filter((g) => g.overtime).length) / games,
    min: 20,
    max: 26,
    unit: '%',
  },
  {
    name: 'Shootout % (unverified)',
    value: (100 * all.filter((g) => g.stats.shootout === 1).length) / games,
    min: 6,
    max: 12,
    unit: '%',
  },
  { name: 'Points gap 1st-last (unverified)', value: avg(pointSpreads), min: 40, max: 70 },
  {
    name: 'Better team wins best-of-7',
    value: (100 * betterTeamSeriesWins) / measuredSeries,
    min: 60,
    max: 65,
    unit: '%',
  },
  // Multi-year (offseason rollover). Ranges: league talent stable, no runaway dynasty, cap legal.
  { name: `League avg rating drift (${years}y)`, value: maxDrift, min: 0, max: 3 },
  { name: `Most titles by one team (${years}y)`, value: maxTitles, min: 0, max: 5 },
  {
    name: 'Payroll / cap, avg (unverified)',
    value: (100 * payrollShare) / payrollSamples,
    min: 75,
    max: 100,
    unit: '%',
  },
  { name: 'Teams over the cap', value: teamsOverCap, min: 0, max: 0 },
  { name: 'Teams over the playoff cap', value: teamsOverPlayoffCap, min: 0, max: 0 },
  { name: 'Teams below roster minimum', value: teamsUnderMinimum, min: 0, max: 0 },
  { name: 'Free-agent pool, largest (unverified)', value: maxPool, min: 0, max: 150 },
];
// TODO (from research): favorite wins ~60% of single games; goalie SV% year-to-year
// r 0.12-0.30; 5-7 of 16 playoff teams turn over each year.

const pad = (s: string, n: number) => s.padEnd(n);
console.log(
  `\nBalance lab: ${seasons} seasons, ${games} games; ${leagues} leagues x ${years} years with rollover; ${(ms / 1000).toFixed(1)}s\n`,
);
console.log(`${pad('Check', 36)}${pad('Value', 10)}${pad('Healthy', 16)}Result`);
let failures = 0;
for (const c of checks) {
  const ok = c.value >= c.min && c.value <= c.max;
  if (!ok) failures++;
  const fmt = (n: number) =>
    (Math.abs(n) < 1 ? n.toFixed(3) : Math.abs(n) < 10 ? n.toFixed(2) : n.toFixed(1)) +
    (c.unit ?? '');
  console.log(
    `${pad(c.name, 36)}${pad(fmt(c.value), 10)}${pad(`${fmt(c.min)}–${fmt(c.max)}`, 16)}${ok ? 'ok' : 'OUT OF RANGE'}`,
  );
}
console.log(
  `\n${failures === 0 ? 'League looks healthy.' : `${failures} check(s) out of range.`}\n`,
);
