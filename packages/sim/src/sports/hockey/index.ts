import {
  GOALIE_RATINGS,
  HOCKEY_POSITIONS,
  isGoalie,
  SKATER_RATINGS,
  type SpecialUnit,
} from '@gm/shared';
import type { SportModule } from '../sport';
import { simGame } from './game';
import { rulesGoalModel, type GoalModel } from './tuning';
import { lineupUnits, specialUnitsView, teamStrength, unitOk, type TeamStrength } from './strength';
import { generateFictionalLeague, generateProspect } from './generate';
import { hockeyLegendAward, pickAwards } from './awards';
import { importHockeyRoster } from './roster';
import {
  hockeyBonusEarned,
  hockeyHallOfFame,
  hockeyHighlights,
  hockeyLeaders,
  hockeyPlayerLines,
} from './stats';
import { hockeyRole } from './builds';

const SKATER_FOCUS = {
  skating: ['skating'],
  shooting: ['shooting'],
  playmaking: ['passing', 'puckHandling', 'hockeyIq'],
  defence: ['defense', 'physical'],
  faceoffs: ['faceoffs'],
};
const GOALIE_FOCUS = { reflexes: ['reflexes'], positioning: ['positioning', 'reboundControl'] };
// The brief's shares, game numbers to check against a sourced count; 'world' is everyone else.
const NATIONS = { canada: 0.35, usa: 0.25, sweden: 0.12, finland: 0.1, czechia: 0.09, world: 0.09 };

/**
 * Hockey (NHL-style). Owns everything that only makes sense in hockey: positions and
 * ratings, the game sim and its tuning, the fictional league generator, the NHL ruleset.
 * The game is played shift by shift (see game.ts); a "result only" mode skips the box score.
 */
export function hockeySport(goalModel: GoalModel = rulesGoalModel): SportModule<TeamStrength> {
  return {
    id: 'nhl',
    positions: HOCKEY_POSITIONS,
    ratingKeys: (position) => (isGoalie(position) ? GOALIE_RATINGS : SKATER_RATINGS),
    trainingFocus: (position) => (isGoalie(position) ? GOALIE_FOCUS : SKATER_FOCUS),
    nations: NATIONS,
    pythagoreanExponent: 2,
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
    bonusEarned: hockeyBonusEarned,
    highlights: hockeyHighlights,
    hallOfFame: hockeyHallOfFame,
    legendAward: hockeyLegendAward,
    role: hockeyRole,
    simGame: (game, rng) => simGame(game, rng, goalModel),
  };
}

export { NHL_2026, FICTIONAL_2026 } from './ruleset-nhl-2026';
export {
  rulesGoalModel,
  strengthEdge,
  HOCKEY_TUNING,
  type GoalModel,
  type ShotInfo,
} from './tuning';
export { simGame, type MatchupInput } from './game';
export { parseXgTable, xgTableFromModel, type XgTable, type XgTableResult } from './xgTable';
export {
  teamStrength,
  autoLineup,
  lineupFit,
  lineupTogether,
  LINEMATES_FULL_GAMES,
  unitFit,
  ICE_TIME,
  type TeamStrength,
  type Lineup,
} from './strength';
export { importHockeyRoster, exportHockeyRoster } from './roster';
export { hockeySeasonStats, type SkaterTotals, type GoalieTotals } from './stats';
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
