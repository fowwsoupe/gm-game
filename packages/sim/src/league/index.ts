/**
 * League & events engine (shared by all sports).
 * Owns: calendar progression, schedule, standings, team status (league pulse), league
 * and turning what happened into events and news. League generation is per sport.
 */
export { makeSchedule } from './schedule';
export { computeStandings } from './standings';
export { classifyTeams } from './status';
export { bracketSeeds, seedPlayoffs, nextRound } from './playoffs';
