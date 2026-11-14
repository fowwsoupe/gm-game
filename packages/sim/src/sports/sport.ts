import type { GameId, GameResult, Player, Sport, Team, TeamId } from '@gm/shared';
import type { Rng } from '../core';
import type { Ruleset } from '../cba';

/**
 * What a sport must provide. Everything else (value, people, CBA math, league calendar,
 * standings, events, finance, the UI shell) is shared by every sport.
 *
 * We start with the NHL only (`sports/hockey`). NBA and NFL will be new folders
 * implementing this same interface; features built on the shared engines then work for
 * them with little or no change.
 */
export interface SportModule<Strength = unknown> {
  id: Sport;
  name: string;

  /** Position codes in display order, e.g. hockey: C, LW, RW, D, G. */
  positions: readonly string[];
  /** Rating keys per position group, so UI and ML know which ratings exist. */
  ratingKeys: (position: string) => readonly string[];

  /** Rules shipped with the sport (season length, cap, contracts...). */
  defaultRuleset: Ruleset;

  /** Builds a fictional league for this sport. */
  generateLeague(rng: Rng): { teams: Team[]; players: Player[] };

  /** Summarizes a roster into whatever the sport's game sim needs. */
  teamStrength(players: readonly Player[]): Strength;

  /** Simulates one game. Must use only `rng` for randomness. */
  simGame(
    game: { id: GameId; homeTeamId: TeamId; awayTeamId: TeamId; home: Strength; away: Strength },
    rng: Rng,
  ): GameResult;
}
