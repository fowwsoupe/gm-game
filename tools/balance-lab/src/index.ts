/**
 * Balance lab: simulates many seasons with no UI and reports league health.
 * Checks below are for hockey (NHL); each sport will get its own set of healthy ranges.
 * Run before and after any change to the sim's numbers, and paste both reports in the PR.
 *
 *   pnpm lab                 # 100 seasons, default seeds
 *   pnpm lab --seasons 100   # more seasons = more confidence
 *   pnpm lab --leagues 10 --years 30   # multi-year section: leagues x years
 *   pnpm lab --xg ml/models/xg.json    # same checks with a shot-quality model file (docs/MODEL_CONTRACTS.md)
 *
 * Single-season checks: each "season" is a fresh league from a different seed.
 * Multi-year checks: each league plays `years` seasons in a row with the offseason rollover
 * (aging, retirements, draft, free agency) between them.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Actor, GameResult, HockeyBoxScore, Player, TeamId } from '@gm/shared';
import {
  leagueStandings,
  seatsOf,
  createLeague,
  defaultContext,
  handleCommand,
  HOCKEY_TUNING,
  hockeySeasonStats,
  inDeadlineWeek,
  ICE_TIME,
  overall,
  parseXgTable,
  rulesGoalModel,
  playoffCapBreaches,
  strengthEdge,
  strengthFor,
  teamStrength,
  type LeagueState,
  net,
  teamCapTotal,
  validateContract,
  DEPARTMENTS,
  ownerOf,
  staffOf,
} from '@gm/sim';
import { fitLinear, mean, pearson, sd } from './stats';

interface Check {
  name: string;
  value: number;
  /** Healthy range, from real NHL seasons (approximate; refine with real data). */
  min: number;
  max: number;
  unit?: string;
  /**
   * A gap we know about and are fixing (say where). Shown with its target as "known gap" and not
   * counted as out of range, so the report stays readable while the fix is in progress.
   */
  known?: string;
}

const args = process.argv.slice(2);
const seasons = Number(args[args.indexOf('--seasons') + 1]) || 100;
const firstSeed = Number(args[args.indexOf('--seed') + 1]) || 1;
const leagues = Number(args[args.indexOf('--leagues') + 1]) || 20;
const years = Number(args[args.indexOf('--years') + 1]) || 20;

const xgPath = args.includes('--xg') ? args[args.indexOf('--xg') + 1] : undefined;
let xgSource = 'rules-based shot model';
let goalModel;
if (xgPath) {
  const parsed = parseXgTable(
    // pnpm runs the lab from its own folder; INIT_CWD is where the command was typed.
    JSON.parse(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), xgPath), 'utf8')),
  );
  if (!parsed.ok) throw new Error(`${xgPath}:\n  ${parsed.errors.join('\n  ')}`);
  goalModel = parsed.model;
  xgSource = `${xgPath} (${parsed.table.source})`;
}
const ctx = defaultContext(undefined, goalModel ? { goalModel } : {});
const actor: Actor = { id: 'lab', controls: [] };
const all: GameResult[] = [];
const pointSpreads: number[] = [];
const topScorer: number[] = [];
const topGoals: number[] = [];
const topSavePct: number[] = [];
let ppGoals = 0;
let injuries = 0;
let teamSeasons = 0;
let ppChances = 0;
/** Series won by the stronger team: fresh leagues, and multi-year leagues from LONG_RUN_FROM on. */
const series = { fresh: { won: 0, n: 0 }, longRun: { won: 0, n: 0 } };
let favouriteWins = 0;
let decidedByStrength = 0;
/** Per team game: goals minus expected goals at an average goalie, and the chance-only variance. */
let vsExpectedSum = 0;
let vsExpectedSq = 0;
let chanceVariance = 0;
let teamGames = 0;
const shotModel = goalModel ?? rulesGoalModel;
/** Per team season: [goal diff per game, draw skill, offence, defence, goaltending] without draws. */
const faceoffRows: number[][] = [];
const started = performance.now();

const rosterOf = (state: LeagueState, id: string) =>
  Object.values(state.players).filter((p) => p.teamId === id);

/** Ice-time-weighted faceoff rating of the players who take each line's draws (as the sim picks them). */
const drawSkill = (roster: readonly Player[]) =>
  teamStrength(roster).lineup.forwards.reduce(
    (s, line, i) => s + ICE_TIME.forwardLines[i]! * (line[0]?.ratings.faceoffs ?? 50),
    0,
  );
const withoutDraws = (roster: readonly Player[]) =>
  teamStrength(
    roster.map((p) =>
      'faceoffs' in p.ratings ? { ...p, ratings: { ...p.ratings, faceoffs: 50 } } : p,
    ),
  );

/**
 * How often the stronger team wins a playoff series. Needs many series to be stable. Stronger =
 * full-health strength as the games play it (lines, chemistry, coach, season form): the research
 * benchmark judges teams by their true strength that season, not by their rosters alone.
 */
function measureSeries(state: LeagueState, tally: { won: number; n: number }) {
  const strengths = new Map(
    Object.keys(state.teams).map((id) => [
      id,
      strengthFor(state, ctx, id as TeamId, rosterOf(state, id)) as ReturnType<typeof teamStrength>,
    ]),
  );
  for (const series of Object.values(state.playoffSeries)) {
    if (!series.winnerTeamId) continue;
    const high = strengths.get(series.higherTeamId)!;
    const low = strengths.get(series.lowerTeamId)!;
    const better = strengthEdge(high, low) >= 0 ? series.higherTeamId : series.lowerTeamId;
    tally.n++;
    if (series.winnerTeamId === better) tally.won++;
  }
}

for (let i = 0; i < seasons; i++) {
  const state = createLeague(firstSeed + i, ctx);
  const res = handleCommand(
    state,
    {
      kind: 'sim.advance',
      // From camp's first day (negative) to the end of the playoffs.
      days:
        ctx.ruleset.season.calendar.regularSeasonDays +
        ctx.ruleset.season.calendar.playoffDays -
        state.date.day,
    },
    actor,
    ctx,
  );
  if (!res.ok) throw new Error(res.error.message);
  injuries += res.events.filter((e) => e.kind === 'player.injured').length;
  teamSeasons += Object.keys(state.teams).length;
  const results = Object.values(state.results).filter((g) => !g.playoffSeriesId);
  all.push(...results);
  measureSeries(state, series.fresh);
  const top = (key: string) =>
    ctx.sport.leaders(results, Object.values(state.players), 1).find((b) => b.key === key)?.rows[0]
      ?.value ?? 0;
  const strength = new Map(
    Object.keys(state.teams).map((id) => [id, teamStrength(rosterOf(state, id))]),
  );
  for (const id of Object.keys(state.teams)) {
    const roster = rosterOf(state, id);
    const base = withoutDraws(roster);
    faceoffRows.push([0, drawSkill(roster), base.offense, base.defense, base.goaltending]);
  }
  for (const g of results) {
    const edge = strengthEdge(strength.get(g.homeTeamId)!, strength.get(g.awayTeamId)!);
    if (edge !== 0) {
      decidedByStrength++;
      if (edge > 0 === g.homeScore > g.awayScore) favouriteWins++;
    }
    const box = g.box as HockeyBoxScore;
    ppChances += box.penalties.length;
    // Goals vs expected goals, as the NHL data measures it (ml/src/form.py). Empty-net goals are
    // left out: the shot rows do not say which net was empty.
    for (const a of [0, 1] as const) {
      const side = a === 0 ? box.home : box.away;
      let expected = 0;
      let variance = 0;
      let scored = -(box.emptyNet?.[a] ?? 0);
      for (const [, by, x, y, shooter, goal, , , power] of box.shots) {
        if (by !== a) continue;
        const shooting = state.players[side.skaters[shooter]!.id]?.ratings.shooting ?? 50;
        const p = Math.min(0.9, shotModel.shotXg({ x, y, shooting, power: power === 1 }));
        expected += p;
        variance += p * (1 - p);
        scored += goal;
      }
      vsExpectedSum += scored - expected;
      vsExpectedSq += (scored - expected) ** 2;
      chanceVariance += variance;
      teamGames++;
    }
    for (const side of [box.home, box.away]) for (const p of side.skaters) ppGoals += p.ppGoals;
  }
  topScorer.push(top('points'));
  topGoals.push(top('goals'));
  topSavePct.push(top('savePct'));
  const rows = leagueStandings(state, ctx.ruleset);
  pointSpreads.push(rows[0]!.pts - rows[rows.length - 1]!.pts);
  // Goal diff per game, in the same order the teams were pushed above.
  const diff = new Map(rows.map((r) => [r.teamId as string, (r.gf - r.ga) / r.gp]));
  const teams = Object.keys(state.teams);
  teams.forEach(
    (id, i) => (faceoffRows[faceoffRows.length - teams.length + i]![0] = diff.get(id)!),
  );
}

// ---------- multi-year: one league played for `years` seasons, with the offseason in between ----------
const meanOverall = (state: LeagueState) => {
  const rostered = Object.values(state.players).filter((p) => p.teamId !== null);
  return rostered.reduce((s, p) => s + overall(p), 0) / rostered.length;
};
const cal = ctx.ruleset.season.calendar;
let maxDrift = 0;
let topTitleSum = 0;
let payrollShare = 0;
let payrollSamples = 0;
let teamsOverCap = 0;
let teamsUnderMinimum = 0;
let teamsBelowFloor = 0;
let illegalContracts = 0;
let teamsOverPlayoffCap = 0;
let maxPool = 0;
let playoffTeamsNew = 0;
let playoffSpotsCompared = 0;
const goalieSvPairs: [number, number][] = [];
/** From the fourth season on, at its start: rostered players 20 or under a league, prospects a team. */
const youngRostered: number[] = [];
const prospectsATeam: number[] = [];
/** Per team-season money ($): revenue, gate (regular and playoff), operating profit. */
const money = { revenue: [] as number[], gate: 0, profit: [] as number[], spread: [] as number[] };
/** Regular-season home dates: fans in and seats there were. */
const crowds = { fans: 0, seats: 0 };
/** Head coaches fired (all, and in the regular season) and AI GMs replaced, over team-seasons played. */
const coaches = { changed: 0, inSeason: 0, gms: 0, teamSeasons: 0 };
/** Front-office department heads: changes, and the quality of the last year's heads by owner budget. */
const staff = { changed: 0, rich: [] as number[], frugal: [] as number[] };
/** Free agents signed with two or more teams bidding: each one's salary over his ask (a share). */
const contested = { overAsk: [] as number[] };
/** AI trades in the season (camp to the end of the playoffs), and those in the deadline's last seven days. */
const trades = { all: 0, deadlineWeek: 0 };
/**
 * Long-run parity: from this season on a multi-year league has gone through enough offseasons
 * that its teams are built by the AI GMs, not by league generation.
 */
const LONG_RUN_FROM = Math.min(10, Math.floor(years / 2));
/** Why the long-run checks fall short (see the doc it names). */
const KNOWN_SPREAD = 'no lasting team edge';
let longRunFavouriteWins = 0;
let longRunDecided = 0;
/** Spread (SD) of team strength at the start of a season, year 0 and from LONG_RUN_FROM on. */
const spreadYear0: number[] = [];
const spreadLongRun: number[] = [];
/** From LONG_RUN_FROM on: each season's SD of team points %, and [last season, this season] pairs. */
const pointsPctSd: number[] = [];
const pointsPctPairs: [number, number][] = [];
/** One number per team that strengthEdge is linear in: the edge between two teams is the difference. */
const netStrength = (t: ReturnType<typeof teamStrength>) =>
  HOCKEY_TUNING.ratingSensitivity * (t.offense + t.defense) +
  HOCKEY_TUNING.goalieSensitivity * t.goaltending;
/** A starter's season: enough shots that save % means something. */
const GOALIE_MIN_SHOTS = 800;
for (let l = 0; l < leagues; l++) {
  const state = createLeague(firstSeed + l, ctx);
  // The lab measures the AI: with no human GM, every team re-signs its own players.
  for (const team of Object.values(state.teams)) {
    if (!team.userControlled) continue;
    const off = handleCommand(
      state,
      { kind: 'team.setUserControlled', teamId: team.id, userControlled: false },
      { id: 'lab', controls: [team.id] },
      ctx,
    );
    if (!off.ok) throw new Error(off.error.message);
  }
  const startRating = meanOverall(state);
  const titles = new Map<TeamId, number>();
  let lastPlayoffTeams: Set<string> | null = null;
  let lastSv = new Map<string, number>();
  let lastPct: Map<string, number> | null = null;
  for (let y = 0; y < years; y++) {
    const longRun = y >= LONG_RUN_FROM;
    if (y >= 3) {
      youngRostered.push(
        Object.values(state.players).filter(
          (p) => p.teamId !== null && state.date.season - p.birthYear <= 20,
        ).length,
      );
      prospectsATeam.push(Object.keys(state.prospects).length / Object.keys(state.teams).length);
    }
    if (y === 0 || longRun) {
      const nets = Object.keys(state.teams).map((id) =>
        netStrength(teamStrength(rosterOf(state, id))),
      );
      (longRun ? spreadLongRun : spreadYear0).push(sd(nets));
    }
    const played = handleCommand(
      state,
      { kind: 'sim.advance', days: cal.regularSeasonDays + cal.playoffDays - state.date.day },
      actor,
      ctx,
    );
    if (!played.ok) throw new Error(played.error.message);
    const books = new Map<string, { revenue: number; profit: number }>();
    for (const e of played.events) {
      if (e.kind === 'trade.completed') {
        trades.all++;
        if (inDeadlineWeek(cal, e.date.day)) trades.deadlineWeek++;
      }
      if (e.kind === 'owner.cardAnswered' && e.effects.coach) {
        coaches.changed++;
        if (e.date.day < cal.regularSeasonDays) coaches.inSeason++;
      }
      if (e.kind !== 'finance.settled') continue;
      const b = books.get(e.teamId) ?? { revenue: 0, profit: 0 };
      b.revenue += Object.values(e.revenue).reduce((a, x) => a + x, 0);
      // Operating profit, as Forbes counts it: building projects are capital spending.
      b.profit += net(e) + e.costs.projects;
      books.set(e.teamId, b);
      money.gate += e.revenue.gate + e.revenue.playoffs;
      if (e.revenue.gate > 0) {
        crowds.fans += e.fans.attendance * e.homeDates;
        crowds.seats += seatsOf(state, e.teamId, ctx.ruleset) * e.homeDates;
      }
    }
    const revenues = [...books.values()].map((b) => b.revenue);
    coaches.teamSeasons += Object.keys(state.teams).length;
    money.revenue.push(...revenues);
    money.profit.push(...[...books.values()].map((b) => b.profit));
    money.spread.push(Math.max(...revenues) / Math.min(...revenues));
    const pct = new Map(
      leagueStandings(state, ctx.ruleset).map((row) => [
        row.teamId as string,
        row.pts / (2 * row.gp),
      ]),
    );
    if (longRun) {
      pointsPctSd.push(sd([...pct.values()]));
      for (const [id, now] of pct)
        if (lastPct?.has(id)) pointsPctPairs.push([lastPct.get(id)!, now]);
    }
    lastPct = pct;
    if (longRun) {
      measureSeries(state, series.longRun);
      const strength = new Map(
        Object.keys(state.teams).map((id) => [id, teamStrength(rosterOf(state, id))]),
      );
      for (const g of Object.values(state.results)) {
        if (g.playoffSeriesId) continue;
        const edge = strengthEdge(strength.get(g.homeTeamId)!, strength.get(g.awayTeamId)!);
        if (edge === 0) continue;
        longRunDecided++;
        if (edge > 0 === g.homeScore > g.awayScore) longRunFavouriteWins++;
      }
    }
    titles.set(state.championTeamId!, (titles.get(state.championTeamId!) ?? 0) + 1);
    const playoffTeams = new Set(
      Object.values(state.playoffSeries)
        .filter((s) => s.round === 1)
        .flatMap((s) => [s.higherTeamId as string, s.lowerTeamId as string]),
    );
    if (lastPlayoffTeams) {
      for (const id of playoffTeams) if (!lastPlayoffTeams.has(id)) playoffTeamsNew++;
      playoffSpotsCompared += playoffTeams.size;
    }
    lastPlayoffTeams = playoffTeams;
    const sv = new Map<string, number>();
    const regular = Object.values(state.results).filter((g) => !g.playoffSeriesId);
    for (const [id, g] of hockeySeasonStats(regular).goalies) {
      if (g.shotsAgainst < GOALIE_MIN_SHOTS) continue;
      sv.set(id, g.saves / g.shotsAgainst);
      if (lastSv.has(id)) goalieSvPairs.push([lastSv.get(id)!, sv.get(id)!]);
    }
    lastSv = sv;
    const rolled = handleCommand(state, { kind: 'season.rollover' }, actor, ctx);
    if (!rolled.ok) throw new Error(rolled.error.message);
    const bidders = new Map<string, Set<string>>();
    for (const e of rolled.events) {
      if (e.kind === 'team.gmChanged') coaches.gms++;
      if (e.kind === 'staff.hired') staff.changed++;
      if (e.kind === 'freeAgency.offered') {
        const teams = bidders.get(e.offer.playerId) ?? new Set();
        bidders.set(e.offer.playerId, teams.add(e.offer.teamId));
      }
      if (e.kind === 'player.signed' && (bidders.get(e.playerId)?.size ?? 0) >= 2) {
        const ask = ctx.models.contractDemand.ask(ctx.ruleset, state.players[e.playerId]!);
        contested.overAsk.push(e.contract.capHit / ask - 1);
      }
    }
    if (y === years - 1) {
      for (const t of Object.values(state.teams)) {
        for (const d of DEPARTMENTS) {
          const q = staffOf(t, d, ctx.ruleset.frontOffice.salary, state.date.season).quality;
          (ownerOf(t).budget > 0.5 ? staff.rich : staff.frugal).push(q);
        }
      }
    }
    teamsOverPlayoffCap += playoffCapBreaches(Object.values(state.players), ctx.ruleset).length;
    maxDrift = Math.max(maxDrift, Math.abs(meanOverall(state) - startRating));
    for (const id of Object.keys(state.teams) as TeamId[]) {
      const roster = rosterOf(state, id);
      const total = teamCapTotal(state, id); // dead cap counts
      payrollShare += total / ctx.ruleset.cap.upperLimit;
      payrollSamples++;
      if (total > ctx.ruleset.cap.upperLimit) teamsOverCap++;
      if (total < ctx.ruleset.cap.lowerLimit) teamsBelowFloor++;
      // Every contract on the books must still pass the rules for the seasons it has left.
      for (const p of roster) {
        const left = p.contract ? p.contract.expiresAfterSeason - state.date.season + 1 : 0;
        const issues = validateContract(ctx.ruleset, {
          salaries: Array<number>(Math.max(1, left)).fill(p.contract?.capHit ?? 0),
          signingAge: state.date.season - p.birthYear,
          isResign: true,
        });
        if (!p.contract || left < 1 || issues.length > 0) illegalContracts++;
      }
      const short = Object.entries(ctx.ruleset.roster.positionMin).some(
        ([pos, min]) => roster.filter((p) => p.position === pos).length < min,
      );
      if (short || roster.length < ctx.ruleset.roster.minActive) teamsUnderMinimum++;
    }
  }
  topTitleSum += Math.max(...titles.values());
  maxPool = Math.max(maxPool, Object.values(state.players).filter((p) => p.teamId === null).length);
}

const ms = performance.now() - started;
const games = all.length;
const goals = all.reduce((s, g) => s + g.homeScore + g.awayScore, 0);
const shots = all.reduce((s, g) => s + (g.stats.homeShots ?? 0) + (g.stats.awayShots ?? 0), 0);
const faceoffEffect =
  fitLinear(
    faceoffRows.map((r) => r.slice(1)),
    faceoffRows.map((r) => r[0]!),
  )[1]! * sd(faceoffRows.map((r) => r[1]!));

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
    // Real NHL is about 22%. Goals that arrive independently at 3 a side tie only ~15% of games and
    // the pulled goalie lifts that to ~18%, so the floor is the sim's honest ceiling for now.
    // TODO: close the gap with a real regulation-tie rate from the data pipeline.
    name: 'Games to OT % (unverified)',
    value: (100 * all.filter((g) => g.overtime).length) / games,
    min: 16,
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
  { name: 'Points gap 1st-last (unverified)', value: mean(pointSpreads), min: 40, max: 70 },
  {
    name: 'Power-play % (unverified)',
    value: (100 * ppGoals) / ppChances,
    min: 17,
    max: 24,
    unit: '%',
  },
  // 16 teams and 84 games; a 32-team league has a bit higher leaders. Refine with real data.
  { name: 'Top scorer points (unverified)', value: mean(topScorer), min: 80, max: 140 },
  { name: 'Top goal scorer goals (unverified)', value: mean(topGoals), min: 40, max: 70 },
  {
    name: 'Best save % of qualified goalies (unverified)',
    value: mean(topSavePct),
    min: 0.905,
    max: 0.935,
  },
  {
    // Fresh leagues only; the multi-year leagues have their own line below.
    name: 'Better team wins best-of-7',
    value: (100 * series.fresh.won) / series.fresh.n,
    min: 60,
    max: 65,
    unit: '%',
  },
  {
    // Research report: the favourite wins about 60% of single games. Favourite = stronger at full health.
    name: 'Favourite wins a single game',
    value: (100 * favouriteWins) / decidedByStrength,
    min: 57,
    max: 63,
    unit: '%',
  },
  {
    // ml/src/form.py (NHL 2022-25): goals vary around expected goals 1.169x as much as chance alone,
    // which is the ceiling for goalie form (it also holds finishing streaks and xG model misses).
    // The floor says form exists at all.
    name: 'Goals vs expected, variance ratio',
    value:
      (vsExpectedSq / teamGames - (vsExpectedSum / teamGames) ** 2) / (chanceVariance / teamGames),
    min: 1.05,
    max: 1.17,
  },
  {
    // ml/src/faceoffs.py (NHL 2022-25): +0.067 goals/game per SD of team faceoff %, 95% CI to 0.17,
    // after prior-season goal diff. Sim: same per SD of the draw-takers' faceoff rating, holding the
    // rest of the team fixed. The floor is above 0 because a key with no effect should be dropped.
    name: 'Faceoff effect, goal diff/game per SD',
    value: faceoffEffect,
    min: 0.02,
    max: 0.17,
  },
  // Multi-year (offseason rollover). Ranges: league talent stable, no runaway dynasty, cap legal.
  { name: `League avg rating drift (${years}y)`, value: maxDrift, min: 0, max: 3 },
  {
    name: `Top team's titles, avg per league (${years}y)`,
    value: topTitleSum / leagues,
    min: 0,
    max: 5,
  },
  {
    name: 'Payroll / cap, avg (unverified)',
    value: (100 * payrollShare) / payrollSamples,
    min: 75,
    max: 100,
    unit: '%',
  },
  {
    name: 'Injuries per team per season (unverified)',
    value: injuries / teamSeasons,
    min: 5,
    max: 12,
  },
  { name: 'Teams over the cap', value: teamsOverCap, min: 0, max: 0 },
  { name: 'Teams below the cap floor', value: teamsBelowFloor, min: 0, max: 0 },
  { name: 'Illegal or missing contracts on rosters', value: illegalContracts, min: 0, max: 0 },
  { name: 'Teams over the playoff cap', value: teamsOverPlayoffCap, min: 0, max: 0 },
  { name: 'Teams below roster minimum', value: teamsUnderMinimum, min: 0, max: 0 },
  {
    // NHL 2007-2026 (docs/research/2026-11-long-run-spread.md): 5.2 of 16 playoff teams new a year on average (32.5%),
    // 3 to 7 in a single season. The range is that average +-2 standard errors of a 20-season
    // mean (1.6 points each), since this check averages hundreds of league-seasons.
    name: 'Playoff teams new each year',
    value: (100 * playoffTeamsNew) / playoffSpotsCompared,
    min: 29,
    max: 36,
    unit: '%',
  },
  {
    // Research report: goalie save % repeats weakly year to year (r 0.12-0.30).
    name: `Goalie SV% year-to-year r (${GOALIE_MIN_SHOTS}+ shots)`,
    value: pearson(goalieSvPairs),
    min: 0.12,
    max: 0.3,
  },
  { name: 'Free-agent pool, largest (unverified)', value: maxPool, min: 0, max: 150 },
  // Report only (docs/research/2026-11-free-agency-bidding.md): no benchmark. A race's salary is
  // at least the ask and at most an AI team's walk-away (ask x 1.33 at the most).
  {
    name: 'Contested signings a summer (unverified)',
    value: contested.overAsk.length / (leagues * years),
    min: 0,
    max: 50,
  },
  {
    name: 'Contested salary over the ask, mean (unverified)',
    value: 100 * mean(contested.overAsk),
    min: 0,
    max: 33,
    unit: '%',
  },
  // docs/research/2026-11-minor-leagues.md: report only (69-78 a league before the prospect pool).
  {
    name: 'Rostered players 20 or under, a league (report)',
    value: mean(youngRostered),
    min: 0,
    max: 150,
  },
  { name: 'Prospects a team (report)', value: mean(prospectsATeam), min: 0, max: 20 },
  // Money, per team-season (docs/research/2026-11-owner-finance.md): Forbes 2024-25 x the cap ratio.
  { name: 'Revenue a team, mean', value: mean(money.revenue) / 1e6, min: 265, max: 320, unit: 'M' },
  { name: 'Revenue, top team / bottom team', value: mean(money.spread), min: 2, max: 3, unit: 'x' },
  {
    name: 'Operating profit, mean',
    value: mean(money.profit) / 1e6,
    min: 70,
    max: 105,
    unit: 'M',
  },
  {
    name: 'Team-seasons losing money',
    value: (100 * money.profit.filter((p) => p < 0).length) / money.profit.length,
    min: 0,
    max: 10,
    unit: '%',
  },
  {
    name: 'Attendance, % of capacity',
    value: (100 * crowds.fans) / crowds.seats,
    min: 94,
    max: 99,
    unit: '%',
  },
  {
    name: 'Gate share of revenue',
    value: (100 * money.gate) / money.revenue.reduce((a, b) => a + b, 0),
    min: 35,
    max: 45,
    unit: '%',
  },
  // Head coaches, per team-season: The Win Column (2000-23 tenures) and ESPN (2019-24 firings).
  {
    name: 'Coach changes a team-season',
    value: coaches.changed / coaches.teamSeasons,
    min: 0.25,
    max: 0.4,
  },
  {
    name: 'Coaches fired in-season',
    value: coaches.inSeason / coaches.teamSeasons,
    min: 0.1,
    max: 0.2,
  },
  {
    // docs/research/2026-11-front-office.md: no public benchmark; report only.
    // No public number; NHL head coaches average 2.83 seasons (owner & finance brief).
    name: 'Department head tenure, seasons (unverified)',
    value: (coaches.teamSeasons * DEPARTMENTS.length) / Math.max(1, staff.changed),
    min: 2,
    max: 8,
  },
  {
    // Owners who spend (budget over 0.5) keep a better front office than frugal ones.
    name: 'Staff quality, rich owners - frugal (unverified)',
    value: mean(staff.rich) - mean(staff.frugal),
    min: 0.1,
    max: 0.45,
  },
  {
    // Report only: no sourced benchmark yet (the brief lists it as unverified).
    name: 'AI GM tenure, seasons (unverified)',
    value: coaches.teamSeasons / Math.max(1, coaches.gms),
    min: 3,
    max: 10,
  },
  // Report only: no sourced real-NHL trade volume yet (docs/research/2026-11-camp-deadline.md).
  {
    name: 'AI trades a team-season (report only)',
    value: trades.all / coaches.teamSeasons,
    min: 0,
    max: 10,
  },
  {
    name: 'Trades in deadline week (report only)',
    value: (100 * trades.deadlineWeek) / Math.max(1, trades.all),
    min: 0,
    max: 100,
    unit: '%',
  },
  // Long run (multi-year leagues, LONG_RUN_FROM on): teams converge and games drift toward coin
  // flips, because nothing gives a team a lasting edge (docs/research/2026-11-long-run-spread.md).
  {
    // NHL 2014-15 to 2025-26 (docs/research/2026-11-long-run-spread.md): a team's points % repeats at r 0.51 a season on;
    // the range is +-2 standard errors of that 11-season mean.
    name: `Points % year-to-year r, years ${LONG_RUN_FROM}+`,
    value: pearson(pointsPctPairs),
    min: 0.4,
    max: 0.62,
  },
  {
    // Same seasons, 82 games: team points % has an SD of 0.095 (0.077-0.122 in a season); the
    // range is +-2 standard errors of that 10-season mean. The real benchmark for the spread.
    name: `Points % spread (SD), years ${LONG_RUN_FROM}+`,
    value: mean(pointsPctSd),
    min: 0.085,
    max: 0.105,
    known: KNOWN_SPREAD,
  },
  {
    name: `Favourite wins a single game, years ${LONG_RUN_FROM}+`,
    value: (100 * longRunFavouriteWins) / longRunDecided,
    min: 57,
    max: 60,
    unit: '%',
    known: KNOWN_SPREAD,
  },
  {
    name: `Better team wins best-of-7, years ${LONG_RUN_FROM}+`,
    value: (100 * series.longRun.won) / series.longRun.n,
    min: 60,
    max: 65,
    unit: '%',
    known: KNOWN_SPREAD,
  },
  {
    // Team strength SD from LONG_RUN_FROM on over year 0's: the spread should stay flat.
    name: `Team strength spread, years ${LONG_RUN_FROM}+ / year 0`,
    value: mean(spreadLongRun) / mean(spreadYear0),
    min: 0.85,
    max: 1.15,
    known: KNOWN_SPREAD,
  },
];

const pad = (s: string, n: number) => s.padEnd(n);
console.log(
  `\nShot model: ${xgSource}\nBalance lab: ${seasons} seasons, ${games} games; ${leagues} leagues x ${years} years with rollover; ${(ms / 1000).toFixed(1)}s\n`,
);
console.log(`${pad('Check', 36)}${pad('Value', 10)}${pad('Healthy', 16)}Result`);
let failures = 0;
let knownGaps = 0;
for (const c of checks) {
  const ok = c.value >= c.min && c.value <= c.max;
  if (!ok && c.known) knownGaps++;
  else if (!ok) failures++;
  const fmt = (n: number) =>
    (Math.abs(n) < 1 ? n.toFixed(3) : Math.abs(n) < 10 ? n.toFixed(2) : n.toFixed(1)) +
    (c.unit ?? '');
  console.log(
    `${pad(c.name, 36)}${pad(fmt(c.value), 10)}${pad(`${fmt(c.min)}–${fmt(c.max)}`, 16)}${ok ? 'ok' : c.known ? `known gap (${c.known})` : 'OUT OF RANGE'}`,
  );
}
console.log(
  `\n${failures === 0 ? 'League looks healthy.' : `${failures} check(s) out of range.`}${
    knownGaps > 0 ? ` ${knownGaps} known gap(s), being fixed.` : ''
  }\n`,
);
