import type {
  GameId,
  GameResult,
  Leaderboard,
  Player,
  PlayerId,
  Sport,
  Team,
  TeamId,
} from '@gm/shared';
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
/** Result of loading a roster file: a ready league, or readable errors for the user. */
export type RosterImport =
  | { ok: true; season: number; name: string; teams: Team[]; players: Player[] }
  | { ok: false; errors: string[] };

export interface SportModule<Strength = unknown> {
  id: Sport;
  name: string;

  /** Position codes in display order, e.g. hockey: C, LW, RW, D, G. */
  positions: readonly string[];
  /** Rating keys per position group, so UI and ML know which ratings exist. */
  ratingKeys: (position: string) => readonly string[];

  /** Rules shipped with the sport (season length, cap, contracts...). */
  defaultRuleset: Ruleset;

  /** Builds a fictional league for this sport, with payrolls legal under `ruleset`. */
  generateLeague(rng: Rng, ruleset: Ruleset): { teams: Team[]; players: Player[] };

  /** A new teamless 18-19 year old, for the draft and undrafted free agents. `season` = the season he joins. */
  generateProspect(rng: Rng, opts: { id: string; season: number; position?: string }): Player;

  /**
   * Picks the player award winners (not the champion) from the finished season: the box scores
   * of its regular-season games (`results`) and of its playoffs (`playoffResults`, with the
   * champion). Deterministic: no randomness.
   */
  pickAwards(input: {
    season: number;
    rules: Ruleset;
    players: readonly Player[];
    results: readonly GameResult[];
    playoffResults: readonly GameResult[];
    championTeamId: TeamId | null;
  }): { award: string; playerId: PlayerId }[];

  /**
   * Stat leaderboards from regular-season results (hockey: points, goals, assists, save %).
   * Players are only used for names and current teams.
   */
  leaders(results: readonly GameResult[], players: readonly Player[], limit: number): Leaderboard[];

  /** Loads a community roster file (untrusted JSON) for this sport. */
  importRoster(json: unknown, rules: Ruleset): RosterImport;

  /** Summarizes a roster into whatever the sport's game sim needs. */
  teamStrength(players: readonly Player[]): Strength;

  /** Simulates one game. Must use only `rng` for randomness. */
  simGame(
    game: {
      id: GameId;
      homeTeamId: TeamId;
      awayTeamId: TeamId;
      home: Strength;
      away: Strength;
      playoff?: boolean;
      /** Score only (no box score, no injuries): the fast mode for playoff odds. */
      resultOnly?: boolean;
      /** The team also played yesterday (hockey: its backup goalie starts). */
      homeBackToBack?: boolean;
      awayBackToBack?: boolean;
    },
    rng: Rng,
  ): GameResult;
}
