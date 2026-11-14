import type { GameId, GameResult, HockeyGameStats, TeamId } from '@gm/shared';
import type { Rng } from '../../core';
import type { TeamStrength } from './strength';

/** Knobs to tune league-wide scoring. Kept in one place so balance changes are easy to find. */
export const HOCKEY_TUNING = {
  leagueAvgGoalsPerTeam: 3.05,
  leagueAvgShotsPerTeam: 30,
  homeIceBoost: 1.04,
  /** How strongly a rating gap moves expected goals. Higher = less parity. */
  ratingSensitivity: 0.025,
  overtimeGoalChance: 0.6,
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
          t.ratingSensitivity * (def.goaltending - 70),
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
}

export function simGame(
  input: MatchupInput,
  rng: Rng,
  model: GoalModel = rulesGoalModel,
): GameResult {
  const xg = model.expectedGoals(input.home, input.away);
  let homeGoals = rng.poisson(xg.home);
  let awayGoals = rng.poisson(xg.away);
  let overtime = false;
  let shootout = false;

  if (homeGoals === awayGoals) {
    overtime = true;
    if (rng.chance(HOCKEY_TUNING.overtimeGoalChance)) {
      if (rng.chance(xg.home / (xg.home + xg.away))) homeGoals++;
      else awayGoals++;
    } else {
      shootout = true;
      if (rng.chance(0.5)) homeGoals++;
      else awayGoals++;
    }
  }

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
  return {
    id: input.id,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    homeScore: homeGoals,
    awayScore: awayGoals,
    overtime,
    stats,
  };
}
