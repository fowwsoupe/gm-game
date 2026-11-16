import {
  GOALIE_RATINGS,
  HOCKEY_POSITIONS,
  isGoalie,
  SKATER_RATINGS,
  type SpecialUnit,
} from '@gm/shared';
import type { SportModule } from '../sport';
import { simGame, rulesGoalModel, type GoalModel } from './game';
import { lineupUnits, specialUnitsView, teamStrength, unitOk, type TeamStrength } from './strength';
import { generateFictionalLeague, generateProspect } from './generate';
import { NHL_2026 } from './ruleset-nhl-2026';
import { pickAwards } from './awards';
import { importHockeyRoster } from './roster';
import { hockeyHallOfFame, hockeyHighlights, hockeyLeaders, hockeyPlayerLines } from './stats';
import { hockeyRole } from './builds';

/**
 * Hockey (NHL-style). Owns everything that only makes sense in hockey: positions and
 * ratings, the game sim and its tuning, the fictional league generator, the NHL ruleset.
 * The game is played shift by shift (see game.ts); a "result only" mode skips the box score.
 */
export function hockeySport(goalModel: GoalModel = rulesGoalModel): SportModule<TeamStrength> {
  return {
    id: 'nhl',
    name: 'Hockey',
    positions: HOCKEY_POSITIONS,
    ratingKeys: (position) => (isGoalie(position) ? GOALIE_RATINGS : SKATER_RATINGS),
    pythagoreanExponent: 2,
    defaultRuleset: NHL_2026,
    generateLeague: generateFictionalLeague,
    generateProspect,
    pickAwards,
    importRoster: importHockeyRoster,
    teamStrength,
    lineup: lineupUnits,
    specialUnits: specialUnitsView,
    unitOk: (unit, players) => unitOk(unit as SpecialUnit, players),
    leaders: hockeyLeaders,
    playerLines: hockeyPlayerLines,
    highlights: hockeyHighlights,
    hallOfFame: hockeyHallOfFame,
    role: hockeyRole,
    simGame: (game, rng) => simGame(game, rng, goalModel),
  };
}

export { NHL_2026, FICTIONAL_2026 } from './ruleset-nhl-2026';
export {
  simGame,
  rulesGoalModel,
  strengthEdge,
  shotQuality,
  HOCKEY_TUNING,
  type GoalModel,
  type ShotInfo,
  type MatchupInput,
} from './game';
export { parseXgTable, xgTableFromModel, type XgTable, type XgTableResult } from './xgTable';
export {
  teamStrength,
  autoLineup,
  lineupUnits,
  ICE_TIME,
  type TeamStrength,
  type Lineup,
} from './strength';
export { importHockeyRoster, exportHockeyRoster } from './roster';
export { hockeyLeaders, hockeySeasonStats, type SkaterTotals, type GoalieTotals } from './stats';
export {
  ratingsFromStats,
  statFeatures,
  ratingGroup,
  FULL_SAMPLE,
  SKATER_FEATURES,
  GOALIE_FEATURES,
  type RatingGroup,
  type RatingFit,
  type RatingEstimate,
  type StatsToRatingsTable,
} from './ratingsFromStats';
export { STATS_TO_RATINGS } from './ratingsFromStatsTable';
export { HOCKEY_DEVELOPMENT } from './aging';
