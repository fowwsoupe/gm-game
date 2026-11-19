/**
 * Core domain types shared by every sport. Nothing here is hockey-, basketball- or
 * football-specific: positions and ratings are open shapes that each sport module types
 * (see ./sports/hockey.ts). We start with the NHL only; NBA and NFL reuse everything here.
 */

export type Sport = 'nhl' | 'nba' | 'nfl';

/** Branded IDs stop you from passing a TeamId where a PlayerId is expected. */
export type Brand<T, B extends string> = T & { readonly __brand: B };
export type TeamId = Brand<string, 'TeamId'>;
export type PlayerId = Brand<string, 'PlayerId'>;
export type GameId = Brand<string, 'GameId'>;

export interface Contract {
  /** Cap hit in whole dollars. Integers only: never store money as floats. */
  capHit: number;
  /** Season the contract ends, e.g. 2029 means it expires after 2028–29. */
  expiresAfterSeason: number;
  /** He cannot be traded without his say; trades involving him are refused (no waiver yet). */
  noTrade?: true;
  /** Whole dollars of each year's cap hit paid as a signing bonus: cash up front, never bought out. */
  bonus?: number;
  /**
   * Whole dollars a year he can earn in performance bonuses (entry-level deals). Not in the cap
   * hit: paid at season end by how his season went; what takes the team over the cap is
   * charged to next season's (`bonusOverage`).
   */
  perfBonus?: number;
}

/**
 * Cap money a team owes that is not a current player's contract: buyouts (dead cap), salary
 * it kept when trading a player (retained), and performance bonuses that went over the cap.
 */
export interface CapCharge {
  teamId: TeamId;
  playerId: PlayerId;
  kind: 'buyout' | 'retained' | 'bonusOverage';
  season: number;
  /** Whole dollars counted against that season's cap. */
  amount: number;
}

/** A team's money over one settlement (a month, or the playoffs): whole dollars, all positive. */
export interface FinanceLines {
  revenue: {
    gate: number;
    gameDay: number;
    sponsorship: number;
    media: number;
    leagueShare: number;
    /** Playoff gate, net of the players' share and the league's fee. */
    playoffs: number;
  };
  costs: {
    salaries: number;
    signingBonuses: number;
    performanceBonuses: number;
    /** Buyouts and retained salary paid to players no longer on the team. */
    deadCap: number;
    operations: number;
    /** Projects under way (a renovation). */
    projects: number;
    /** The head coach's and department heads' salaries. Absent in settlements from before coaches. */
    staff?: number;
  };
}

/** A team's fans. `interest` is 0-100 (50 = an average market's average year). */
export interface TeamFans {
  interest: number;
  /** The interest the sponsorship deal (each summer) and local media deal (every 3 seasons) were priced at. */
  sponsorDeal: number;
  mediaDeal: number;
  /** Average crowd at the last month's home dates (0 before any). */
  attendance: number;
}

/** Fans of a new league, or of an old save that has none yet. */
export const NEW_FANS: TeamFans = { interest: 50, sponsorDeal: 50, mediaDeal: 50, attendance: 0 };

/** Ticket price policy: whole percent around the league's reference price. */
export const TICKET_STEPS = [-20, -10, 0, 10, 20] as const;

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
  injuryHistory?: InjuryHistory;
  /** Refusing to report until he is paid. */
  holdout?: true;
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
  /** On your trade block: AI GMs call about him more often. */
  onBlock?: true;
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
  noTrade?: true;
  /** Share (whole percent) of the salary paid as a signing bonus. */
  bonusPct?: number;
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
  /** Career injuries and days missed. Absent = never hurt. */
  injuryHistory?: InjuryHistory;
}

/** How often and how long a player has been hurt. */
export interface InjuryHistory {
  count: number;
  days: number;
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
  /** The head coach. Absent: derived from the id. His quality moves the team's strength in games. */
  coach?: CoachProfile;
  /** Front-office department heads. A department absent: derived from the id. No effects yet. */
  staff?: Partial<Record<Department, StaffProfile>>;
}

/**
 * Front-office departments besides the head coach (docs/research/2026-11-front-office.md). The
 * assistant GM only works for a human GM (docs/research/2026-11-assistant-gm.md).
 */
export type Department = 'scouting' | 'development' | 'medical' | 'assistant';

/** The head of a front-office department; his salary stands for the whole department's cost. */
export interface StaffProfile {
  name: string;
  /** 0-1: how good the department is. Hidden like player ratings; shown as a word. */
  quality: number;
  /** First season in the job. */
  hired: number;
  /** Whole dollars a season. */
  salary: number;
}

/**
 * A head coach. His deal runs `years` seasons from `hired`, and renews on the same terms while
 * he keeps the job; firing him pays what is left of the current deal.
 */
export interface CoachProfile {
  name: string;
  /** First season in the job. */
  hired: number;
  /** Whole dollars a season. */
  salary: number;
  years: number;
  /** 0-1: how good a coach he is. Absent: derived from his name and first season. */
  quality?: number;
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

/** The person who owns a team. Derived from the team id; nothing is stored. */
export interface OwnerProfile {
  name: string;
  /** 0-1: from profit (0) to winning (1). */
  priority: number;
  /** 0-1: how long he waits on a bad season. */
  patience: number;
  /** 0-1: how far from the cap floor toward the cap he lets payroll go. */
  budget: number;
}

/** What an owner asks of a season; `met` is set at the season-end review. */
export interface OwnerObjective {
  /**
   * playoffs: make them. series: win `target` playoff series. pointsPct: finish at `target` or
   * better. profit: earn `target` dollars or more over the season.
   */
  kind: 'playoffs' | 'series' | 'pointsPct' | 'profit';
  target: number;
  met?: boolean;
}

/** An owner's view of his GM, and this season's plan. Moved only by owner events. */
export interface OwnerStanding {
  /** 0-100: what the owner thinks of the GM. */
  confidence: number;
  /** The GM's first season under this owner: his honeymoon counts from here. */
  since: number;
  /** The season the objectives are for. */
  season: number;
  objectives: OwnerObjective[];
  /** Points % the owner expects this season. */
  expected: number;
  /** Most the owner wants on the cap (payroll and dead cap) this season. */
  payrollBudget: number;
  /** Cash when the season opened: the review's profit is cash then less this. */
  cashAtStart: number;
  /** Points % at the last review (next season's expectation starts from it). */
  lastPct?: number;
  /**
   * The coach's heat carried into this season: how far results have sat below expectation since
   * he was hired, in points % x seasons (absent = 0). This season's games add to it as they go.
   */
  coachHeat?: number;
  /** The season the owner last asked a human GM to fire the coach mid-season (once a season). */
  coachAsked?: number;
  /** The season the owner last warned a human GM that his job is on the line (absent: never). */
  warned?: number;
}

/**
 * A human GM out of work: fired by `firedFrom`'s owner at the `season` review. `offers` are the
 * teams with a vacancy that want him (filled each summer as AI GMs leave or are fired).
 */
export interface Career {
  firedFrom: TeamId;
  season: number;
  offers: TeamId[];
}

/** The Owner screen: the owner, his view of you, the money's flow and every meeting, oldest first. */
export interface OwnerReport {
  owner: OwnerProfile;
  standing: OwnerStanding;
  cash: number;
  /** Each settlement: its revenue and costs, and cash after it. */
  money: { season: number; day: number; revenue: number; costs: number; cash: number }[];
  meetings: {
    season: number;
    meeting: 'preseason' | 'deadline' | 'review';
    objectives: OwnerObjective[];
    confidence: number;
  }[];
}

/** What answering a card changes: amounts are added; `ticketPct` sets the price step. */
export interface CardEffects {
  cash?: number;
  fanInterest?: number;
  confidence?: number;
  payrollBudget?: number;
  ticketPct?: number;
  /** Starts a project: it costs `costPerSeason` for `seasons` seasons from next season, then pays off. */
  project?: {
    kind: 'renovation';
    seasons: number;
    costPerSeason: number;
    seats: number;
    fanInterest: number;
  };
  /** Fires the coach and hires `hire`; his heat starts at `heat` (cancels this season's so far). */
  coach?: { hire: CoachProfile; heat: number };
}

/**
 * A project under way: it costs `costPerSeason` in each season from `first` until `ready`, and at
 * the start of `ready` the arena gains `seats` and the fans `fanInterest`.
 */
export interface OwnerProject {
  id: string;
  teamId: TeamId;
  kind: 'renovation';
  first: number;
  ready: number;
  costPerSeason: number;
  seats: number;
  fanInterest: number;
}

/** A decision the owner puts to a human GM (`owner.answerCard`). AI GMs answer without one. */
export interface OwnerCard {
  id: string;
  teamId: TeamId;
  kind:
    | 'ticketPrice'
    | 'deadlineBuy'
    | 'deadlineSell'
    | 'budget'
    | 'namingRights'
    | 'spendToCap'
    | 'fireSale'
    | 'renovation'
    | 'festival'
    | 'fireCoach'
    | 'hotSeat';
  /** Text params: `amount` in dollars, `pct` in whole percent. */
  params: Record<string, number>;
  /** `noted`: a warning, nothing to decide. */
  options: { key: 'agree' | 'refuse' | 'more' | 'noted'; effects: CardEffects }[];
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
  /**
   * The units each side dressed (hockey: forward lines and defence pairs), by player id. Only on
   * the `game.final` event: the reducer counts them into `linemates` and does not keep them.
   */
  units?: { home: PlayerId[][]; away: PlayerId[][] };
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
}

/** A game with everything the game center needs: the result (and box score) plus player names by id. */
export interface GameDetail {
  result: GameResult;
  names: Record<string, string>;
  /** Length of one overtime period in seconds (a full period in the playoffs, shorter otherwise). */
  overtimeSeconds: number;
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

/** What the Leaders screen gets: each row also carries the player's age, for his face. */
export interface LeaderboardView extends Leaderboard {
  rows: (Leaderboard['rows'][number] & { age: number })[];
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
  /**
   * Top-N protection on the first-round picks you give: if one lands in the first `protectTop`
   * picks of that draft you keep it instead of passing it on.
   */
  protectTop?: number;
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
    | 'no_trade'
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
  /** You were fired and have no team (null: you have a job, or never had one). */
  career: Career | null;
  /** The save option: owners may fire a human GM (default on). */
  canBeFired: boolean;
}

/**
 * How a free agent feels about an offer. Each factor is scored 0–100 and weighted by what a
 * player of his age cares about; he signs when `interest` reaches `threshold`.
 */
export interface SigningInterest {
  /** An offer sheet to a restricted free agent: the draft picks it would cost, and whether you own them. */
  sheet?: { picks: string[]; owned: boolean };
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

/** What the scouts say about a prospect: rating keys they like and dislike, and if he could play soon. */
export interface ScoutReport {
  strengths: string[];
  weakness: string;
  ready: boolean;
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
  report: ScoutReport;
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
    | 'tradeRequest'
    | 'holdout'
    | 'dispute'
    // The assistant GM's advice: who to extend first, and take or turn down an offer.
    | 'adviceResign'
    | 'adviceTake'
    | 'adviceDecline';
  params?: Record<string, string | number>;
  screen: 'roster' | 'cap' | 'draft' | 'trades' | 'lines';
}

/** What the Home screen needs for a team beyond standings: the to-do list and the next game. */
export interface Dashboard {
  todo: TodoItem[];
  /** The owner's open cards: each waits on an answer. */
  ownerCards: OwnerCard[];
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
