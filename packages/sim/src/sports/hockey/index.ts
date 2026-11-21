import {
  BENCH_ORDERS,
  GOALIE_RATINGS,
  HOCKEY_POSITIONS,
  isGoalie,
  MATCH_LINES,
  SKATER_RATINGS,
  type SpecialUnit,
} from '@gm/shared';
import type { SportModule } from '../sport';
import { simGame } from './game';
import { rulesGoalModel, type GoalModel } from './tuning';
import { lineupUnits, specialUnitsView, teamStrength, unitOk, type TeamStrength } from './strength';
import {
  generateFictionalLeague,
  generateProspect,
  hockeyFarmLeague,
  hockeyProspectLeague,
  hockeyProspectOrigin,
} from './generate';
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
import { hockeyLeagueLine } from './leagueLines';

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
    prospectOrigin: hockeyProspectOrigin,
    prospectLeague: hockeyProspectLeague,
    farmLeague: hockeyFarmLeague,
    leagueLine: hockeyLeagueLine,
    pickAwards,
    importRoster: importHockeyRoster,
    teamStrength,
    lineup: lineupUnits,
    specialUnits: specialUnitsView,
    unitOk: (unit, players) => unitOk(unit as SpecialUnit, players),
    benchOrderOk: (order, value, home) =>
      order === 'match'
        ? home &&
          value !== undefined &&
          Number.isInteger(value) &&
          value >= 0 &&
          value <= MATCH_LINES
        : (BENCH_ORDERS as readonly string[]).includes(order) && value === undefined,
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
  SKATER_BUILD_CLUSTERS,
  type GoalModel,
} from './tuning';
export { simGame } from './game';
export { parseXgTable, xgTableFromModel } from './xgTable';
export {
  teamStrength,
  autoLineup,
  lineupFit,
  FIT_BASELINE,
  lineupTogether,
  LINEMATES_FULL_GAMES,
  unitFit,
  ICE_TIME,
} from './strength';
export { importHockeyRoster, exportHockeyRoster } from './roster';
export { hockeySeasonStats } from './stats';
export {
  ratingsFromStats,
  statFeatures,
  ratingGroup,
  FULL_SAMPLE,
  type RatingGroup,
  type RatingFit,
  type StatsToRatingsTable,
} from './ratingsFromStats';
export { STATS_TO_RATINGS } from './ratingsFromStatsTable';
export { type RatingsToStatsTable } from './leagueLines';
export { HOCKEY_DEVELOPMENT } from './aging';
export { PLAY_TRAITS, playTraitOf } from './builds';
