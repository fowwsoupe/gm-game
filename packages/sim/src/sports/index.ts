/**
 * Sports registry. Each sport is a module implementing `SportModule`.
 * Today: hockey (NHL) only. Planned: basketball (NBA), football (NFL), as sibling folders.
 */
export type { RosterImport, SportModule } from './sport';
export {
  hockeySport,
  NHL_2026,
  FICTIONAL_2026,
  simGame,
  rulesGoalModel,
  HOCKEY_TUNING,
  HOCKEY_DEVELOPMENT,
  teamStrength,
  importHockeyRoster,
  exportHockeyRoster,
  type GoalModel,
  type MatchupInput,
  type TeamStrength,
} from './hockey';
