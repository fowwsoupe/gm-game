import type { GameDate, SeasonPhase } from '@gm/shared';

/**
 * The league calendar, as data. Day 0 = opening night of the regular season.
 * Negative days are preseason; days after the regular season are playoffs, then offseason.
 * Real dates (October 7, etc.) are a display concern only.
 */
export interface CalendarConfig {
  preseasonDays: number;
  regularSeasonDays: number;
  /** Last day trades are allowed, as a day index. */
  tradeDeadlineDay: number;
  playoffDays: number;
}

export function phaseOf(cal: CalendarConfig, date: GameDate): SeasonPhase {
  if (date.day < 0) return 'preseason';
  if (date.day < cal.regularSeasonDays) return 'regular';
  if (date.day < cal.regularSeasonDays + cal.playoffDays) return 'playoffs';
  return 'offseason';
}

export const addDays = (date: GameDate, days: number): GameDate => ({
  season: date.season,
  day: date.day + days,
});

export const compareDates = (a: GameDate, b: GameDate): number =>
  a.season - b.season || a.day - b.day;
