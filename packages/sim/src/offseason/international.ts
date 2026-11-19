import type { GameId, GameResult, InternationalTournament, Player, TeamId } from '@gm/shared';
import { playerName, type Emit, type LeagueState, type Rng } from '../core';
import { nationOf } from '../people';
import type { SimContext } from '../context';
import { hurtOn } from '../tonight';

/**
 * Step 8, in a season divisible by `international.every`: the international tournament
 * (docs/research/2026-11-summer-training.md). Each of the sport's nations dresses its best healthy
 * rostered players, the lineup a league team would dress (a nation short at a position takes the
 * mixed team's best spare there); two groups of three play a round robin, the top two of each cross
 * in the semi-finals, then a one-game final. Its games draw only on `rng` and are not league games.
 */
export function playInternational(
  state: LeagueState,
  ctx: SimContext,
  rng: Rng,
  emit: Emit,
  season: number,
): void {
  if (season % ctx.ruleset.international.every !== 0) return;
  const { sport } = ctx;
  const nations = Object.keys(sport.nations);
  const rostered = Object.values(state.players)
    .filter((p) => p.teamId !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
  // How many each lineup unit holds on most league teams (hockey: 3 a line, 2 a pair, 2 goalies).
  const sizes = new Map<string, number[]>();
  for (const teamId of Object.keys(state.teams).sort()) {
    for (const u of sport.lineup(rostered.filter((p) => p.teamId === teamId))) {
      sizes.set(u.unit, [...(sizes.get(u.unit) ?? []), u.playerIds.length]);
    }
  }
  const size = (unit: string) => {
    const s = (sizes.get(unit) ?? [0]).sort((a, b) => a - b);
    return s[s.length >> 1]!;
  };
  const healthy = rostered.filter((p) => !hurtOn(p, state.date.day));
  const byId = new Map(healthy.map((p) => [p.id as string, p]));
  const dress = (pool: Player[], depth: string[] = []) =>
    sport
      .lineup(pool, depth)
      .flatMap((u) => u.playerIds.slice(0, size(u.unit)).map((id) => byId.get(id)!));

  const pools = new Map(nations.map((n) => [n, [] as Player[]]));
  for (const p of healthy) pools.get(nationOf(p.id, sport.nations))!.push(p);
  const mixed = nations[nations.length - 1]!;
  const rosters = new Map([[mixed, dress(pools.get(mixed)!)]]);
  let spare = pools.get(mixed)!.filter((p) => !rosters.get(mixed)!.includes(p));
  for (const n of nations.slice(0, -1)) {
    // His own players first (in the order the sport would dress them), spares only where short.
    const own = pools.get(n)!;
    const dressed = dress(
      [...own, ...spare],
      dress(own).map((p) => p.id),
    );
    rosters.set(n, dressed);
    spare = spare.filter((p) => !dressed.includes(p));
  }
  const strength = new Map(
    [...rosters].map(
      ([n, r]) =>
        [
          n,
          sport.teamStrength(
            r,
            r.map((p) => p.id),
          ),
        ] as const,
    ),
  );

  const results: GameResult[] = [];
  /** Plays a game and returns [winner, loser]. */
  const play = (home: string, away: string, playoff: boolean) => {
    const id = `intl-${season}-${results.length + 1}` as GameId;
    const g = sport.simGame(
      {
        id,
        homeTeamId: home as TeamId,
        awayTeamId: away as TeamId,
        home: strength.get(home),
        away: strength.get(away),
        playoff,
      },
      rng.fork(id),
    );
    results.push(g);
    return g.homeScore > g.awayScore ? [home, away] : [away, home];
  };

  const { win, overtimeLoss } = ctx.ruleset.season.points;
  const groups = [0, 1].map((k) => nations.filter((_, i) => [0, 1, 1, 0][i % 4] === k));
  const tables = groups.map((group) => {
    const rows = group.map((nation) => ({
      nation,
      wins: 0,
      points: 0,
      goalsFor: 0,
      goalsAgainst: 0,
    }));
    const row = (n: string) => rows.find((r) => r.nation === n)!;
    group.forEach((home, i) =>
      group.slice(i + 1).forEach((away) => {
        const [w, l] = play(home, away, false) as [string, string];
        const g = results[results.length - 1]!;
        row(w).wins++;
        row(w).points += win;
        if (g.overtime) row(l).points += overtimeLoss;
        row(home).goalsFor += g.homeScore;
        row(home).goalsAgainst += g.awayScore;
        row(away).goalsFor += g.awayScore;
        row(away).goalsAgainst += g.homeScore;
      }),
    );
    const diff = (r: (typeof rows)[number]) => r.goalsFor - r.goalsAgainst;
    return rows.sort((a, b) => b.points - a.points || diff(b) - diff(a) || b.goalsFor - a.goalsFor);
  });
  const [a, b] = tables as [(typeof tables)[number], (typeof tables)[number]];
  const [first] = play(a[0]!.nation, b[1]!.nation, true);
  const [second] = play(b[0]!.nation, a[1]!.nation, true);
  const [champion, runnerUp] = play(first!, second!, true) as [string, string];

  const top = sport.leaders(results, [...rosters.values()].flat(), 1)[0];
  const best = top?.rows[0];
  const tournament: InternationalTournament = {
    season,
    groups: tables,
    games: results.map((g) => ({
      home: g.homeTeamId,
      away: g.awayTeamId,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      overtime: g.overtime,
    })),
    champion,
    ...(best && {
      best: {
        playerId: best.playerId,
        name: best.name,
        nation: nationOf(best.playerId, sport.nations),
        key: top.key,
        value: best.value,
      },
    }),
  };
  emit('notable', [], { kind: 'international.played', tournament });
  // Your players' medals make your news.
  for (const [nation, medal] of [
    [champion, 'Gold'],
    [runnerUp, 'Silver'],
  ] as const) {
    for (const p of rosters.get(nation)!) {
      if (!p.teamId || !state.teams[p.teamId]?.userControlled) continue;
      emit('notable', [p.teamId], {
        kind: 'news.posted',
        headline: `event.international${medal}`,
        playerId: p.id,
        params: { player: playerName(p), nation },
      });
    }
  }
}
