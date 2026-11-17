/**
 * Core domain types shared by every sport. Nothing here is hockey-, basketball- or
 * football-specific: positions and ratings are open shapes that each sport module types
 * (see ./sports/hockey.ts). We start with the NHL only; NBA and NFL reuse everything here.
 */

export type Sport = 'nhl' | 'nba' | 'nfl';

/** Branded IDs stop you from passing a TeamId where a PlayerId is expected. */
export type Brand<T, B extends string> = T & { readonly __brand: B };
export type LeagueId = Brand<string, 'LeagueId'>;
export type TeamId = Brand<string, 'TeamId'>;
export type PlayerId = Brand<string, 'PlayerId'>;
export type GameId = Brand<string, 'GameId'>;

export interface Contract {
  /** Cap hit in whole dollars. Integers only: never store money as floats. */
  capHit: number;
  /** Season the contract ends, e.g. 2029 means it expires after 2028–29. */
  expiresAfterSeason: number;
}

/**
 * Cap money a team owes that is not a current player's contract: buyouts (dead cap), and salary
 * it kept when trading a player (retained).
 */
export interface CapCharge {
  teamId: TeamId;
  playerId: PlayerId;
  kind: 'buyout' | 'retained';
  season: number;
  /** Whole dollars counted against that season's cap. */
  amount: number;
}

/** Why a team's cap is not legal in a season. The cap advisor shows these; it never blocks. */
export type CapIssue =
  | { code: 'over_cap'; over: number }
  | { code: 'over_offseason_limit'; over: number }
  | { code: 'below_floor'; short: number };

/** One season of a team's cap sheet. Money is whole dollars. */
export interface CapSeason {
  season: number;
  upperLimit: number;
  lowerLimit: number;
  /** Players under contract that season, biggest cap hit first. */
  contracts: { playerId: PlayerId; capHit: number; expiresAfterSeason: number }[];
  /** Sum of `contracts`. */
  committed: number;
  /** Buyout charges for that season. */
  deadCap: number;
  total: number;
  /** Upper limit minus total (negative = over). */
  space: number;
  issues: CapIssue[];
}

/** A team's cap now and in future seasons. Future seasons assume today's cap limits. */
export interface CapSheet {
  teamId: TeamId;
  seasons: CapSeason[];
}

/** What a player on a team asks to re-sign, and what that deal does to each cap season. */
export interface ResignOffer {
  playerId: PlayerId;
  /** Asking cap hit per year, whole dollars. */
  ask: number;
  maxYears: number;
  /** Per season of the team's cap sheet: the cap issues if he is signed through that season. */
  issues: CapIssue[][];
}

/** A player as the roster and cap screens see him (no hidden ratings). */
export interface RosterPlayer {
  id: PlayerId;
  firstName: string;
  lastName: string;
  birthYear: number;
  position: string;
  contract?: Contract;
}

/**
 * A player as the roster screen and player card see him: no hidden ratings, only where he
 * ranks. `percentiles` (0–100) compare each rating with every rostered player who has the same
 * rating keys (hockey: skaters with skaters, goalies with goalies).
 */
export interface PlayerProfile extends RosterPlayer {
  teamId: TeamId | null;
  age: number;
  /** First day back from injury, if hurt. */
  injuredUntil?: number;
  percentiles: { key: string; value: number }[];
  /** Sport-defined build and role tags (hockey: 'sniper', 'shutdownD'...; tags 'speed', 'shot'...). */
  build: string;
  tags: string[];
  /** Personality traits worth mentioning (people engine keys: 'loyalty', 'hotHeaded'...). */
  traits: string[];
  /** This regular season's stat line, sport-defined keys (hockey: gp, goals, assists...). */
  stats: Record<string, number>;
  /** What he would ask per year on a new contract today, whole dollars. */
  ask: number;
  /** Free agents: how many AI teams have an open offer to him (they compete with yours). */
  rivalOffers: number;
  /** Rostered players: how happy he is, 0-100, with the four things behind it (each 0-100). */
  morale?: { value: number; factors: { key: string; score: number }[] };
  /** Restricted free agent: the team holding his rights (it may match another team's offer sheet). */
  rightsTeamId?: TeamId;
}

/** An open offer to a free agent; he answers the next day, picking the one he likes best. */
export interface FreeAgentOffer {
  playerId: PlayerId;
  teamId: TeamId;
  /** Per year, whole dollars. */
  salary: number;
  years: number;
}

export interface Player {
  id: PlayerId;
  firstName: string;
  lastName: string;
  birthYear: number;
  teamId: TeamId | null;
  /** Sport-specific position code (hockey: 'C' | 'LW' | 'RW' | 'D' | 'G'). */
  position: string;
  /** Hidden ceiling the player can develop towards. Not shown directly in the UI. */
  potential: number;
  /**
   * Hidden ratings, 1–99, flat and numeric so ML models can consume them directly.
   * Which keys exist is defined by the sport (hockey: ./sports/hockey.ts).
   */
  ratings: Record<string, number>;
  contract?: Contract;
  /** Signed in season to start when `contract` ends (an extension). Takes over at the summer's expiries. */
  extension?: Contract;
  /** Season he joined his current team (chemistry). Absent: since before the league began. */
  joined?: number;
  /** Injured: first day (of the current season) he can play again. Absent = healthy. Heals over the summer. */
  injuredUntil?: number;
}

export interface Team {
  id: TeamId;
  city: string;
  name: string;
  abbreviation: string;
  /** Optional league structure. The schedule plays division rivals most, then the conference. */
  conference?: string;
  division?: string;
  /** Owned by the human player(s). The game supports running several teams. */
  userControlled: boolean;
  /** The AI front office running the team when no human does. Absent: derived from the id. */
  gm?: GmProfile;
  /** The AI GM's plan for the next seasons. Absent: none yet (follows the standings). */
  plan?: TeamPlan;
}

/** Go for it while the core is good, tune around the edges, or tear down and build up. */
export type TeamPlanKind = 'contend' | 'retool' | 'rebuild';

export interface TeamPlan {
  kind: TeamPlanKind;
  /** First season of this plan (a rebuild is given time). */
  since: number;
}

/**
 * How an AI GM builds a team. `winNow` spends the future on this season, `builder` the other
 * way round, `balanced` follows the team's situation alone.
 */
export type GmStyle = 'winNow' | 'balanced' | 'builder';

export interface GmProfile {
  style: GmStyle;
  /** 0-1: how well he reads players. A low-skill GM over- and underrates players, always the same ones. */
  skill: number;
}

/** Generic standings row. `otl` stays 0 in sports without overtime-loss points. */
export interface StandingsRow {
  teamId: TeamId;
  gp: number;
  w: number;
  l: number;
  otl: number;
  pts: number;
  /** Points / goals for and against (whatever the sport scores). */
  gf: number;
  ga: number;
}

/** Result of any game in any sport. Sport-specific numbers go in `stats`. */
export interface GameResult {
  id: GameId;
  /** Present only for a playoff game; keeps regular-season standings separate. */
  playoffSeriesId?: string;
  homeTeamId: TeamId;
  awayTeamId: TeamId;
  homeScore: number;
  awayScore: number;
  /** Decided after regulation (overtime, shootout, extra innings...). */
  overtime: boolean;
  /** Sport-specific box-score numbers, typed by the sport module (hockey: HockeyGameStats). */
  stats: Record<string, number>;
  /** Sport-specific box score with player lines (hockey: HockeyBoxScore). */
  box?: unknown;
  /**
   * Players hurt in this game and how many days they miss. Not stored with the game: the engine
   * turns it into `player.injured` events and strips it.
   */
  injuries?: { playerId: PlayerId; days: number }[];
}

/** One finished game in a list. */
export interface GameSummary {
  id: string;
  homeTeamId: TeamId;
  awayTeamId: TeamId;
  homeScore: number;
  awayScore: number;
  overtime: boolean;
  shootout: boolean;
  playoff: boolean;
}

/** A game with everything the game center needs: the result (and box score) plus player names by id. */
export interface GameDetail {
  result: GameResult;
  names: Record<string, string>;
}

export interface PlayoffSeries {
  id: string;
  round: number;
  higherSeed: number;
  lowerSeed: number;
  higherTeamId: TeamId;
  lowerTeamId: TeamId;
  higherWins: number;
  lowerWins: number;
  winnerTeamId?: TeamId;
}

/** One award a season (sport-defined keys like 'mvp', plus 'champion'), as the History screen lists it. */
export interface AwardEntry {
  season: number;
  award: string;
  teamId: TeamId;
  /** Absent for team awards (champion). */
  playerId?: PlayerId;
  playerName?: string;
}

/** A stat table: the top players for one stat ('points', 'goals', 'savePct' in hockey). */
export interface Leaderboard {
  key: string;
  rows: { playerId: PlayerId; name: string; teamId: TeamId | null; gp: number; value: number }[];
}

/** One league record: best (or most) of something, by a team or player in one season, or all-time for titles. */
export interface RecordEntry {
  key:
    | 'points'
    | 'wins'
    | 'goalsFor'
    | 'goalsAgainst'
    | 'titles'
    | 'playerGoals'
    | 'playerAssists'
    | 'playerPoints'
    | 'playerSavePct';
  /** Team records only. */
  teamId?: TeamId;
  /** Player records only (retired players have no team any more). */
  playerName?: string;
  /** Absent for all-time records (titles). */
  season?: number;
  value: number;
}

/** One scheduled regular-season game. */
export interface ScheduledGame {
  id: string;
  date: { season: number; day: number };
  homeTeamId: TeamId;
  awayTeamId: TeamId;
}

/**
 * A two-team trade: `give` goes from `fromTeamId` to `toTeamId`, `get` comes back. `retain`:
 * share (whole percent) of a given player's cap hit `fromTeamId` keeps paying.
 */
export interface TradeProposal {
  fromTeamId: TeamId;
  toTeamId: TeamId;
  give: PlayerId[];
  get: PlayerId[];
  retain?: { playerId: PlayerId; pct: number }[];
  /** Draft picks (ids like `2028-1-t3`: draft season, round, original team) each way. */
  givePicks?: string[];
  getPicks?: string[];
}

/** Salary kept in a trade: the player's new cap hit, and what the old team owes each season. */
export interface RetainedSalary {
  playerId: PlayerId;
  capHit: number;
  charges: CapCharge[];
}

/** Why a trade is accepted or refused. The UI translates `code`; `params` fill the text. */
export interface TradeReason {
  code:
    | 'accepted'
    | 'value_short'
    | 'quantity'
    | 'bad_contract'
    | 'rental'
    | 'prospect'
    | 'fills_need'
    | 'over_cap'
    | 'short_at'
    | 'closed'
    | 'empty'
    | 'not_on_team'
    | 'retention'
    | 'not_your_pick'
    | 'pick';
  params?: Record<string, string | number>;
}

/** What the other team says. `value`: its net gain in surplus dollars (negative = it loses). */
export interface TradeEvaluation {
  accepted: boolean;
  value: number;
  reasons: TradeReason[];
}

/** Where the league is, for the Home screen and the buttons that depend on it. */
export interface LeagueStatus {
  season: number;
  day: number;
  phase: 'preseason' | 'regular' | 'playoffs' | 'offseason';
  championTeamId: TeamId | null;
  /** Between opening free agency and starting the next season. */
  freeAgencyOpen: boolean;
  tradeDeadlineDay: number;
  /** First day of the playoffs, and the last day they can run (the calendar's, as day indexes). */
  playoffsStartDay: number;
  playoffsEndDay: number;
  /** Trades allowed right now. */
  tradesOpen: boolean;
}

/**
 * How a free agent feels about an offer. Each factor is scored 0–100 and weighted by what a
 * player of his age cares about; he signs when `interest` reaches `threshold`.
 */
export interface SigningInterest {
  playerId: PlayerId;
  /** His asking salary per year, whole dollars. */
  ask: number;
  maxYears: number;
  interest: number;
  threshold: number;
  factors: {
    key: 'money' | 'winning' | 'role' | 'term' | 'loyalty' | 'home';
    score: number;
    weight: number;
  }[];
}

/**
 * A draft-eligible player. The sim keeps the whole player (true potential hidden); everyone,
 * AI teams included, sees only the scouted potential range `low`–`high`.
 */
export interface DraftProspect {
  player: Player;
  low: number;
  high: number;
}

/** A prospect as the draft board shows him: no hidden ratings. */
export interface DraftBoardEntry {
  id: PlayerId;
  firstName: string;
  lastName: string;
  position: string;
  age: number;
  low: number;
  high: number;
}

/** One team's league pulse: playoff odds, power rating and status. */
export interface PulseRow {
  teamId: TeamId;
  /** Chance to make the playoffs, 0–1. */
  playoffOdds: number;
  /** Win share from scoring so far, 0–1 (the power ranking orders by it). */
  rating: number;
  status: 'contender' | 'buyer' | 'bubble' | 'seller' | 'rebuilder' | 'crisis';
}

/** One thing on the Home "To do" list. The UI translates `code`, fills `params`, and links to `screen`. */
export interface TodoItem {
  code:
    | 'resign'
    | 'draftList'
    | 'freeAgency'
    | 'injured'
    | 'rosterShort'
    | 'overCap'
    | 'deadline'
    | 'tradeOffers'
    | 'tradeRequest';
  params?: Record<string, string | number>;
  screen: 'roster' | 'cap' | 'draft' | 'trades';
}

/** What the Home screen needs for a team beyond standings: the to-do list and the next game. */
export interface Dashboard {
  todo: TodoItem[];
  nextGame: { opponentId: TeamId; home: boolean; day: number } | null;
  /** Playoff odds if the next regular-season game is won or lost (absent outside the season). */
  raceNight?: { ifWin: number; ifLose: number };
}

/** One season of a player's career: his team at the end of it and his regular-season line. */
export interface CareerLine {
  season: number;
  teamId: TeamId | null;
  stats: Record<string, number>;
}

/** One thing that happened to a player's contract or team (from the event log). */
export interface PlayerMove {
  season: number;
  kind: 'drafted' | 'signed' | 'extended' | 'traded' | 'boughtOut' | 'expired';
  /** The team he joined (drafted, signed, extended, traded to) or left (bought out, expired). */
  teamId: TeamId;
  /** Cap hit of the new deal, if there is one. */
  capHit?: number;
}

/** A player's awards and moves, oldest first. */
export interface PlayerHistory {
  awards: { season: number; award: string }[];
  moves: PlayerMove[];
}

/** A draft pick a team owns. `season` is the draft's (the class joins that season). */
export interface DraftPick {
  id: string;
  season: number;
  round: number;
  originalTeamId: TeamId;
  ownerTeamId: TeamId;
}

/** A retired player voted into the Hall of Fame, with his career totals and awards. */
export interface HallOfFamer {
  playerId: PlayerId;
  name: string;
  position: string;
  retiredSeason: number;
  seasons: number;
  /** Regular-season career totals, sport-defined keys. */
  totals: Record<string, number>;
  /** Award keys he won, one entry per win. */
  awards: string[];
}

/**
 * An AI GM's offer to a human team. `proposal` is written from the AI's side (`fromTeamId` is
 * the AI team, `give` what it sends, `get` what it wants back). Open until `expiresDay`.
 */
export interface TradeOffer {
  id: string;
  proposal: TradeProposal;
  expiresDay: number;
}
