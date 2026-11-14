/**
 * League & events engine.
 * Owns: calendar progression, schedule, standings, team status (league pulse), league
 * generation, and turning what happened into events and news.
 */
export { roundRobinSchedule } from './schedule';
export { computeStandings } from './standings';
export { classifyTeams } from './status';
export { generateFictionalLeague } from './generate';
