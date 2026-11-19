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

  /** Position codes in display order, e.g. hockey: C, LW, RW, D, G. */
  positions: readonly string[];
  /** Rating keys per position group, so UI and ML know which ratings exist. */
  ratingKeys: (position: string) => readonly string[];

  /** Pythagorean exponent for win share from scoring (hockey about 2), for odds and power rankings. */
  pythagoreanExponent: number;

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

  /**
   * A player's build and role tags (keys the UI translates, e.g. hockey 'sniper', 'speed'), from
   * his percentiles within his group.
   */
  role(
    position: string,
    percentiles: readonly { key: string; value: number }[],
  ): { build: string; tags: string[] };

  /**
   * Hall of Fame: whether a retired player's career (one stat line per season, his awards)
   * earns induction, and his career totals.
   */
  hallOfFame(input: {
    position: string;
    seasons: readonly Record<string, number>[];
    awards: readonly string[];
  }): { inducted: boolean; totals: Record<string, number> };

  /**
   * Share (0-1) of his performance bonus a player earned with this season's stat line
   * (`playerLines`), out of `seasonGames` regular-season games.
   */
  bonusEarned(line: Readonly<Record<string, number>>, seasonGames: number): number;

  /** Standout individual nights in a finished game (hockey: hat tricks, shutouts), as news keys. */
  highlights(result: GameResult): { key: string; playerId: PlayerId; teamId: TeamId }[];

  /** Each player's stat line over these games, by player id (hockey: gp, goals, assists, points...). */
  playerLines(results: readonly GameResult[]): Map<string, Record<string, number>>;

  /** Loads a community roster file (untrusted JSON) for this sport. */
  importRoster(json: unknown, rules: Ruleset): RosterImport;

  /**
   * Summarizes a roster into whatever the sport's game sim needs. `depth` is the GM's order of
   * players, best first; the lineup follows it ahead of ratings. `chemistry` (0–1, default 0.5)
   * is the people engine's team chemistry; the sport decides its (capped) effect. `linemates` is
   * the team's games together by pair (`LeagueState.linemates`).
   */
  teamStrength(
    players: readonly Player[],
    depth?: readonly string[],
    chemistry?: number,
    units?: Partial<Record<string, readonly string[]>>,
    linemates?: Readonly<Record<string, number>>,
    /** Rating points the head coach and the team's season form add to every player (negative: take away). */
    coaching?: number,
  ): Strength;

  /** Power-play / penalty-kill units as the game uses them (`custom` = set by the GM, else auto). */
  specialUnits(
    players: readonly Player[],
    depth?: readonly string[],
    units?: Partial<Record<string, readonly string[]>>,
  ): Record<string, { playerIds: string[]; custom: boolean }>;

  /** Whether these players make a valid saved unit of that name (hockey: 3F+2D / 2F+2D). */
  unitOk(unit: string, players: readonly Player[]): boolean;

  /** The lineup the game would dress, as named units in order (hockey: F1–F4, D1–D3, G). */
  lineup(
    players: readonly Player[],
    depth?: readonly string[],
  ): { unit: string; playerIds: string[] }[];

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
      /** The starter plays the second night of a back-to-back anyway (hockey: a little worse). */
      homeTired?: boolean;
      awayTired?: boolean;
      /** The medical staff's factor on re-injury risk (1 = average, below 1 = better). */
      homeMedical?: number;
      awayMedical?: number;
    },
    rng: Rng,
  ): GameResult;
}
