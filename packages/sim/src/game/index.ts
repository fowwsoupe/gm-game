/**
 * Game sim engine.
 * Owns: simulating games (detailed and fast), team strength, the GoalModel plug-in point.
 * TODO(feature): line-by-line sim (who's on the ice, special teams, goalie rules), event
 * stream with locations for the match viewer, fast "result only" mode for playoff odds.
 */
export { simGame, rulesGoalModel, HOCKEY_TUNING, type GoalModel, type MatchupInput } from './game';
export { teamStrength, type TeamStrength } from './strength';
