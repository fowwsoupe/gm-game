import { GOALIE_RATINGS, HOCKEY_POSITIONS, isGoalie, SKATER_RATINGS } from '@gm/shared';
import type { SportModule } from '../sport';
import { simGame, rulesGoalModel, type GoalModel } from './game';
import { teamStrength, type TeamStrength } from './strength';
import { generateFictionalLeague, generateProspect } from './generate';
import { NHL_2026 } from './ruleset-nhl-2026';
import { pickAwards } from './awards';
import { importHockeyRoster } from './roster';
import { hockeyLeaders } from './stats';

/**
 * Hockey (NHL-style). Owns everything that only makes sense in hockey: positions and
 * ratings, the game sim and its tuning, the fictional league generator, the NHL ruleset.
 * TODO(feature): line-by-line sim (who's on the ice, special teams, goalie rules), event
 * stream with locations for the match viewer, fast "result only" mode for playoff odds.
 */
export function hockeySport(goalModel: GoalModel = rulesGoalModel): SportModule<TeamStrength> {
  return {
    id: 'nhl',
    name: 'Hockey',
    positions: HOCKEY_POSITIONS,
    ratingKeys: (position) => (isGoalie(position) ? GOALIE_RATINGS : SKATER_RATINGS),
    defaultRuleset: NHL_2026,
    generateLeague: generateFictionalLeague,
    generateProspect,
    pickAwards,
    importRoster: importHockeyRoster,
    teamStrength,
    leaders: hockeyLeaders,
    simGame: (game, rng) => simGame(game, rng, goalModel),
  };
}

export { NHL_2026, FICTIONAL_2026 } from './ruleset-nhl-2026';
export { simGame, rulesGoalModel, HOCKEY_TUNING, type GoalModel, type MatchupInput } from './game';
export { teamStrength, autoLineup, ICE_TIME, type TeamStrength, type Lineup } from './strength';
export { importHockeyRoster, exportHockeyRoster } from './roster';
export { hockeyLeaders, hockeySeasonStats } from './stats';
export { HOCKEY_DEVELOPMENT } from './aging';
