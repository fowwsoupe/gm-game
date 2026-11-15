import type { GameId, GameResult, HockeyGameStats, TeamId } from '@gm/shared';
import type { Rng } from '../../core';
import { makeBoxScore } from './box';
import type { TeamStrength } from './strength';

/** Knobs to tune league-wide scoring. Kept in one place so balance changes are easy to find. */
export const HOCKEY_TUNING = {
  leagueAvgGoalsPerTeam: 2.74,
  leagueAvgShotsPerTeam: 26.4,
  /** The average starting goalie's rating: a team with this goalie gets no edge or penalty. */
  leagueAvgGoaltending: 67,
  homeIceBoost: 1.07,
  /** How strongly a rating gap moves expected goals. Higher = less parity. */
  ratingSensitivity: 0.0118,
  overtimeGoalChance: 0.6,
  /** A team down one goal late pulls its goalie and ties it this often (why real games go to overtime more than independent scoring says). */
  lateEqualizerChance: 0.25,
} as const;

/**
 * Anything that can predict expected goals for a matchup.
 * The default is rules-based; an ML-trained model can implement the same interface.
 */
export interface GoalModel {
  expectedGoals(home: TeamStrength, away: TeamStrength): { home: number; away: number };
}

export const rulesGoalModel: GoalModel = {
  expectedGoals(home, away) {
    const t = HOCKEY_TUNING;
    const edge = (atk: TeamStrength, def: TeamStrength) =>
      Math.exp(
        t.ratingSensitivity * (atk.offense - def.defense) -
          t.ratingSensitivity * (def.goaltending - t.leagueAvgGoaltending),
      );
    return {
      home: t.leagueAvgGoalsPerTeam * edge(home, away) * t.homeIceBoost,
      away: t.leagueAvgGoalsPerTeam * edge(away, home),
    };
  },
};

export interface MatchupInput {
  id: GameId;
  homeTeamId: TeamId;
  awayTeamId: TeamId;
  home: TeamStrength;
  away: TeamStrength;
  playoff?: boolean;
  /** The team played yesterday: its backup goalie starts. */
  homeBackToBack?: boolean;
  awayBackToBack?: boolean;
}

export function simGame(
  input: MatchupInput,
  rng: Rng,
  model: GoalModel = rulesGoalModel,
): GameResult {
  const backup = (backToBack?: boolean) => !!backToBack && !input.playoff;
  const tired = (s: TeamStrength, b2b?: boolean): TeamStrength =>
    backup(b2b) ? { ...s, goaltending: s.backupGoaltending } : s;
  const xg = model.expectedGoals(
    tired(input.home, input.homeBackToBack),
    tired(input.away, input.awayBackToBack),
  );
  let homeGoals = rng.poisson(xg.home);
  let awayGoals = rng.poisson(xg.away);
  if (Math.abs(homeGoals - awayGoals) === 1 && rng.chance(HOCKEY_TUNING.lateEqualizerChance)) {
    if (homeGoals < awayGoals) homeGoals++;
    else awayGoals++;
  }
  let overtime = false;
  let shootout = false;
  let overtimeGoal: 'home' | 'away' | null = null;
  let shootoutGoals = { home: 0, away: 0 };

  if (homeGoals === awayGoals) {
    overtime = true;
    if (input.playoff || rng.chance(HOCKEY_TUNING.overtimeGoalChance)) {
      overtimeGoal = rng.chance(xg.home / (xg.home + xg.away)) ? 'home' : 'away';
    } else {
      shootout = true;
      shootoutGoals = rng.chance(0.5) ? { home: 1, away: 0 } : { home: 0, away: 1 };
    }
  }
  const credited = {
    home: homeGoals + (overtimeGoal === 'home' ? 1 : 0),
    away: awayGoals + (overtimeGoal === 'away' ? 1 : 0),
  };
  homeGoals = credited.home + shootoutGoals.home;
  awayGoals = credited.away + shootoutGoals.away;

  const shots = (goals: number, expected: number) =>
    Math.max(
      goals,
      Math.round(
        HOCKEY_TUNING.leagueAvgShotsPerTeam * (expected / HOCKEY_TUNING.leagueAvgGoalsPerTeam),
      ) + rng.int(-6, 6),
    );

  const stats: HockeyGameStats = {
    homeShots: shots(homeGoals, xg.home),
    awayShots: shots(awayGoals, xg.away),
    shootout: shootout ? 1 : 0,
  };
  const { box, injuries } = makeBoxScore(
    {
      home: input.home,
      away: input.away,
      homeBackup: backup(input.homeBackToBack),
      awayBackup: backup(input.awayBackToBack),
      goals: credited,
      shots: { home: stats.homeShots, away: stats.awayShots },
      overtimeGoal,
    },
    rng,
  );
  return {
    id: input.id,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    homeScore: homeGoals,
    awayScore: awayGoals,
    overtime,
    stats,
    box,
    ...(injuries.length ? { injuries } : {}),
  };
}
