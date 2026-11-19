import Database from 'better-sqlite3';
import type {
  AwardEntry,
  PlayerHistory,
  PlayerMove,
  CareerLine,
  CapCharge,
  GameResult,
  Importance,
  LeagueEvent,
  OwnerReport,
  Player,
  PlayerId,
  PlayoffSeries,
  Sport,
  Team,
  TeamId,
  TeamStatus,
} from '@gm/shared';
import type { LeagueState, ScheduledGame } from '@gm/sim';
import { migrations } from './migrations';

export type Db = Database.Database;

/**
 * Opens (or creates) a save file. One league = one .sqlite file, which keeps
 * Steam Cloud sync and "copy your save to a friend" simple. Pass ':memory:' in tests.
 */
export function openSave(path: string): SaveFile {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return new SaveFile(db);
}

export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > migrations.length)
    throw new Error('This save is from a newer version of the game.');
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

/**
 * League state kept as JSON in meta rather than its own table (each is small: one draft class,
 * open offers...), with the value used when a save lacks the key. Load and save both loop here.
 */
const JSON_META = {
  draftClass: '[]',
  draftOrder: '[]',
  draftBoards: '{}',
  depthCharts: '{}',
  specialUnits: '{}',
  pickOwners: '{}',
  pickProtection: '{}',
  tradeOffers: '[]',
  tradeRequests: '[]',
  holdouts: '[]',
  disputes: '[]',
  linemates: '{}',
  cash: '{}',
  fans: '{}',
  ticketPrices: '{}',
  owners: '{}',
  ownerCards: '[]',
  projects: '[]',
  arenas: '{}',
  career: 'null',
  canBeFired: 'true',
  stopOn: '["league","yours","offers","injuries"]',
  faOffers: '[]',
  rfaRights: '{}',
  formerTeams: '{}',
  goalieRotation: '{}',
  tradeBlock: '[]',
  rfaSheets: '[]',
  lastSeason: '{}',
} satisfies Partial<Record<keyof LeagueState, string>>;

const IMPORTANCE_RANK: Record<Importance, number> = { minor: 0, notable: 1, major: 2 };

interface PlayerRow {
  id: string;
  team_id: string | null;
  first_name: string;
  last_name: string;
  birth_year: number;
  position: Player['position'];
  potential: number;
  ratings_json: string;
  contract_json: string | null;
  extension_json: string | null;
  joined_season: number | null;
  injured_until: number | null;
  injury_count: number;
  injury_days: number;
}

/**
 * All database access goes through here. The UI and sim never write SQL.
 *
 * Shape of the contract with the sim:
 * - `createLeague` (sim) → `saveNewLeague(state)` writes it once.
 * - `loadState()` rebuilds the in-memory LeagueState when a save opens.
 * - After every command, `persist(events, state)` stores the events and the rows they changed.
 *   Mirrors the sim reducer `applyEvent`: when you add an event kind, handle it in both.
 */
export class SaveFile {
  constructor(readonly db: Db) {}

  close() {
    this.db.close();
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string) {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  // ---------- whole league ----------

  saveNewLeague(state: LeagueState) {
    const insertTeam = this.db.prepare(
      'INSERT INTO teams (id, city, name, abbreviation, user_controlled, status, conference, division, gm_json, plan_json, coach_json, staff_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insertPlayer = this.insertPlayer();
    const insertGame = this.insertGame();
    const insertCharge = this.insertCapCharge();
    this.db.transaction(() => {
      for (const t of Object.values(state.teams)) {
        insertTeam.run(
          t.id,
          t.city,
          t.name,
          t.abbreviation,
          t.userControlled ? 1 : 0,
          state.teamStatus[t.id] ?? 'bubble',
          t.conference ?? null,
          t.division ?? null,
          t.gm ? JSON.stringify(t.gm) : null,
          t.plan ? JSON.stringify(t.plan) : null,
          t.coach ? JSON.stringify(t.coach) : null,
          t.staff ? JSON.stringify(t.staff) : null,
        );
      }
      for (const p of Object.values(state.players)) insertPlayer(p);
      for (const g of state.schedule) insertGame(g);
      for (const c of state.capCharges) insertCharge(c);
      this.writeClock(state);
      this.setMeta('sport', state.sport);
      this.setMeta('rulesetId', state.rulesetId);
    })();
  }

  loadState(): LeagueState {
    const season = Number(this.getMeta('season'));
    const teams = this.listTeams();
    const statusRows = this.db.prepare('SELECT id, status FROM teams').all() as {
      id: TeamId;
      status: TeamStatus;
    }[];
    const schedule = this.db
      .prepare(
        `SELECT id, season, day, home_team_id AS homeTeamId, away_team_id AS awayTeamId
         FROM games WHERE season = ? AND playoff_series_id IS NULL ORDER BY day, rowid`,
      )
      .all(season) as {
      id: string;
      season: number;
      day: number;
      homeTeamId: TeamId;
      awayTeamId: TeamId;
    }[];
    const playoffRows = this.db
      .prepare('SELECT * FROM playoff_series WHERE id GLOB ?')
      .all(`s${season}_*`) as {
      id: string;
      round: number;
      higher_seed: number;
      lower_seed: number;
      higher_team_id: TeamId;
      lower_team_id: TeamId;
      higher_wins: number;
      lower_wins: number;
      winner_team_id: TeamId | null;
    }[];
    return {
      sport: (this.getMeta('sport') ?? 'nhl') as Sport,
      rulesetId: this.getMeta('rulesetId') ?? 'nhl-2026',
      date: { season, day: Number(this.getMeta('day')) },
      rngState: Number(this.getMeta('rngState')),
      eventSeq: Number(this.getMeta('eventSeq')),
      teams: Object.fromEntries(teams.map((t) => [t.id, t])),
      players: Object.fromEntries(this.listPlayers().map((p) => [p.id, p])),
      teamStatus: Object.fromEntries(statusRows.map((r) => [r.id, r.status])) as Record<
        TeamId,
        TeamStatus
      >,
      schedule: schedule.map((g): ScheduledGame => ({
        id: g.id,
        date: { season: g.season, day: g.day },
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
      })),
      results: Object.fromEntries(this.playedResults(season).map((r) => [r.id, r])),
      playoffSeries: Object.fromEntries(
        playoffRows.map((r) => [
          r.id,
          {
            id: r.id,
            round: r.round,
            higherSeed: r.higher_seed,
            lowerSeed: r.lower_seed,
            higherTeamId: r.higher_team_id,
            lowerTeamId: r.lower_team_id,
            higherWins: r.higher_wins,
            lowerWins: r.lower_wins,
            ...(r.winner_team_id ? { winnerTeamId: r.winner_team_id } : {}),
          } satisfies PlayoffSeries,
        ]),
      ),
      championTeamId: (this.getMeta('championTeamId') as TeamId | undefined) ?? null,
      freeAgencyOpen: this.getMeta('freeAgencyOpen') === '1',
      ...(Object.fromEntries(
        Object.entries(JSON_META).map(([k, d]) => [k, JSON.parse(this.getMeta(k) ?? d)]),
      ) as Pick<LeagueState, keyof typeof JSON_META>),
      capCharges: (
        this.db
          .prepare(
            'SELECT team_id, player_id, kind, season, amount FROM cap_charges ORDER BY rowid',
          )
          .all() as {
          team_id: TeamId;
          player_id: PlayerId;
          kind: CapCharge['kind'];
          season: number;
          amount: number;
        }[]
      ).map((r) => ({
        teamId: r.team_id,
        playerId: r.player_id,
        kind: r.kind,
        season: r.season,
        amount: r.amount,
      })),
    };
  }

  private insertPlayer() {
    const stmt = this.db.prepare(
      `INSERT INTO players (id, team_id, first_name, last_name, birth_year, position, potential, ratings_json, contract_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    return (p: Player) =>
      stmt.run(
        p.id,
        p.teamId,
        p.firstName,
        p.lastName,
        p.birthYear,
        p.position,
        p.potential,
        JSON.stringify(p.ratings),
        p.contract ? JSON.stringify(p.contract) : null,
      );
  }

  private insertGame() {
    const stmt = this.db.prepare(
      'INSERT INTO games (id, season, day, home_team_id, away_team_id) VALUES (?, ?, ?, ?, ?)',
    );
    return (g: ScheduledGame) =>
      stmt.run(g.id, g.date.season, g.date.day, g.homeTeamId, g.awayTeamId);
  }

  private insertCapCharge() {
    const stmt = this.db.prepare(
      'INSERT INTO cap_charges (team_id, player_id, kind, season, amount) VALUES (?, ?, ?, ?, ?)',
    );
    return (c: CapCharge) => stmt.run(c.teamId, c.playerId, c.kind, c.season, c.amount);
  }

  /** Stores events and the rows they changed, in one transaction. */
  persist(events: readonly LeagueEvent[], state: LeagueState) {
    const insertEvent = this.db.prepare(
      `INSERT INTO events (id, season, day, kind, importance, team_ids, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const recordGame = this.db.prepare(
      `UPDATE games SET played = 1, home_score = ?, away_score = ?, overtime = ?, stats_json = ?, box_json = ? WHERE id = ?`,
    );
    const insertPlayoffGame = this.db.prepare(
      `INSERT OR IGNORE INTO games (id, season, day, home_team_id, away_team_id, playoff_series_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertSeries = this.db.prepare(
      `INSERT INTO playoff_series (id, round, higher_seed, lower_seed, higher_team_id, lower_team_id,
       higher_wins, lower_wins) VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
    );
    const updateSeries = this.db.prepare(
      `UPDATE playoff_series SET higher_wins = ?, lower_wins = ?, winner_team_id = ? WHERE id = ?`,
    );
    const insertPlayer = this.insertPlayer();
    const setRatings = this.db.prepare(
      'UPDATE players SET ratings_json = ?, potential = ? WHERE id = ?',
    );
    // Any contract change ends a pending extension (signing it, expiry, buyout).
    const setContract = this.db.prepare(
      'UPDATE players SET team_id = ?, contract_json = ?, extension_json = NULL WHERE id = ?',
    );
    const setExtension = this.db.prepare('UPDATE players SET extension_json = ? WHERE id = ?');
    const retire = this.db.prepare(
      'UPDATE players SET retired_season = ?, team_id = NULL, contract_json = NULL WHERE id = ?',
    );
    const setInjury = this.db.prepare(
      'UPDATE players SET injured_until = ?, injury_count = injury_count + 1, injury_days = injury_days + ? WHERE id = ?',
    );
    const insertCharge = this.insertCapCharge();
    const dropOldCharges = this.db.prepare('DELETE FROM cap_charges WHERE season < ?');
    const healAll = this.db.prepare('UPDATE players SET injured_until = NULL');
    const insertGame = this.insertGame();
    const insertAward = this.db.prepare(
      'INSERT OR REPLACE INTO awards (season, award, team_id, player_id) VALUES (?, ?, ?, ?)',
    );
    const setStatus = this.db.prepare('UPDATE teams SET status = ? WHERE id = ?');
    const setControl = this.db.prepare('UPDATE teams SET user_controlled = ? WHERE id = ?');
    const setGm = this.db.prepare('UPDATE teams SET gm_json = ? WHERE id = ?');
    const setPlan = this.db.prepare('UPDATE teams SET plan_json = ? WHERE id = ?');
    const setCoach = this.db.prepare('UPDATE teams SET coach_json = ? WHERE id = ?');
    const setStaff = this.db.prepare('UPDATE teams SET staff_json = ? WHERE id = ?');
    const setTeam = this.db.prepare('UPDATE players SET team_id = ? WHERE id = ?');
    // Who joined a new team (or left one) in these events; written from the final state below.
    const moved = new Set<string>();
    const setJoined = this.db.prepare('UPDATE players SET joined_season = ? WHERE id = ?');
    const setContractOnly = this.db.prepare('UPDATE players SET contract_json = ? WHERE id = ?');
    const archiveLine = this.db.prepare(
      'INSERT OR REPLACE INTO player_seasons (player_id, season, team_id, stats_json) VALUES (?, ?, ?, ?)',
    );

    this.db.transaction(() => {
      for (const e of events) {
        // Clock ticks are bookkeeping, not news: kept out of the log to keep it small.
        if (e.kind !== 'clock.advanced') {
          insertEvent.run(
            e.id,
            e.date.season,
            e.date.day,
            e.kind,
            e.importance,
            JSON.stringify(e.teamIds),
            // The box score lives in the games table; keeping it here too would double the save.
            JSON.stringify(
              e.kind === 'game.final'
                ? { ...e, result: { ...e.result, box: undefined, units: undefined } }
                : e.kind === 'stats.archived'
                  ? { ...e, lines: undefined } // kept in player_seasons
                  : e,
            ),
          );
        }
        switch (e.kind) {
          case 'game.final': {
            const r = e.result;
            if (r.playoffSeriesId) {
              insertPlayoffGame.run(
                r.id,
                e.date.season,
                e.date.day,
                r.homeTeamId,
                r.awayTeamId,
                r.playoffSeriesId,
              );
            }
            recordGame.run(
              r.homeScore,
              r.awayScore,
              r.overtime ? 1 : 0,
              JSON.stringify(r.stats),
              r.box ? JSON.stringify(r.box) : null,
              r.id,
            );
            break;
          }
          case 'series.started': {
            const s = e.series;
            insertSeries.run(
              s.id,
              s.round,
              s.higherSeed,
              s.lowerSeed,
              s.higherTeamId,
              s.lowerTeamId,
            );
            break;
          }
          case 'series.won':
          case 'champion.crowned':
            break;
          case 'players.developed':
            for (const c of e.changes)
              setRatings.run(JSON.stringify(c.ratings), c.potential, c.playerId);
            break;
          case 'award.given':
            insertAward.run(e.season, e.award, e.teamId, e.playerId ?? null);
            break;
          case 'player.retired':
            retire.run(e.date.season, e.playerId);
            break;
          case 'contract.boughtOut':
            moved.add(e.playerId);
            setContract.run(null, null, e.playerId);
            for (const c of e.charges) insertCharge(c);
            break;
          case 'player.injured':
            setInjury.run(e.until, e.days, e.playerId);
            break;
          case 'contract.expired':
            moved.add(e.playerId);
            setContract.run(null, null, e.playerId);
            break;
          case 'player.drafted': {
            const p = e.player;
            moved.add(p.id);
            insertPlayer(p);
            break;
          }
          case 'player.signed':
            moved.add(e.playerId);
            setContract.run(e.teamId, JSON.stringify(e.contract), e.playerId);
            break;
          case 'season.started':
            for (const g of e.schedule) insertGame(g);
            this.db
              .prepare("DELETE FROM meta WHERE key IN ('championTeamId', 'freeAgencyOpen')")
              .run();
            healAll.run();
            dropOldCharges.run(e.season);
            break;
          case 'team.statusChanged':
            setStatus.run(e.to, e.teamId);
            break;
          case 'team.controlChanged':
            setControl.run(e.userControlled ? 1 : 0, e.teamId);
            break;
          case 'team.gmChanged':
            setGm.run(JSON.stringify(e.gm), e.teamId);
            break;
          case 'staff.hired':
            setStaff.run(JSON.stringify(state.teams[e.teamId]?.staff ?? null), e.teamId);
            break;
          case 'career.fired':
            setControl.run(0, e.teamId);
            setGm.run(JSON.stringify(e.gm), e.teamId);
            break;
          case 'career.hired':
            setControl.run(1, e.teamId);
            break;
          case 'career.offers':
          case 'league.optionSet':
            break; // stored with the clock below
          case 'team.planChanged':
            setPlan.run(JSON.stringify(e.plan), e.teamId);
            break;
          case 'contract.extended':
            setExtension.run(JSON.stringify(e.contract), e.playerId);
            break;
          case 'bonuses.paid':
            for (const c of e.charges) insertCharge(c);
            break;
          case 'stats.archived':
            for (const l of e.lines) {
              archiveLine.run(l.playerId, e.season, l.teamId, JSON.stringify(l.stats));
            }
            break;
          case 'draft.classAnnounced':
          case 'draft.boardSet':
          case 'lines.set':
          case 'units.set':
          case 'goalies.rotationSet':
          case 'trade.blockSet':
          case 'trade.offered':
          case 'freeAgency.offered':
          case 'freeAgency.sheetReceived':
          case 'freeAgency.sheetDropped':
          case 'player.tradeRequested':
          case 'player.tradeRequestEnded':
          case 'player.disputeStarted':
          case 'player.disputePromised':
          case 'player.disputeListed':
          case 'player.disputeEnded':
          case 'player.holdoutStarted':
          case 'player.holdoutEnded':
          case 'trade.offerClosed':
          case 'finance.settled':
          case 'finance.ticketPriceSet':
          case 'owner.meeting':
          case 'owner.confidenceMoved':
          case 'owner.frustrated':
          case 'owner.cardOpened':
          case 'project.finished':
            break; // stored with the clock below
          case 'owner.cardAnswered':
            if (e.effects.coach) setCoach.run(JSON.stringify(e.effects.coach.hire), e.teamId);
            break; // the rest is stored with the clock below
          case 'freeAgency.opened':
            this.setMeta('freeAgencyOpen', '1');
            break;
          case 'trade.completed':
            for (const id of [...e.give, ...e.get]) moved.add(id);
            for (const id of e.give) setTeam.run(e.toTeamId, id);
            for (const id of e.get) setTeam.run(e.fromTeamId, id);
            for (const r of e.retained ?? []) {
              const contract = state.players[r.playerId]?.contract;
              if (contract) setContractOnly.run(JSON.stringify(contract), r.playerId);
              for (const c of r.charges) insertCharge(c);
            }
            break;
          case 'clock.advanced':
          case 'season.phaseChanged':
          case 'news.posted':
            break;
          default: {
            const unhandled: never = e;
            throw new Error(`persist: unhandled event ${(unhandled as LeagueEvent).kind}`);
          }
        }
      }
      for (const id of moved) {
        const p = state.players[id];
        if (p) setJoined.run(p.joined ?? null, id);
      }
      for (const s of Object.values(state.playoffSeries)) {
        updateSeries.run(s.higherWins, s.lowerWins, s.winnerTeamId ?? null, s.id);
      }
      if (state.championTeamId) this.setMeta('championTeamId', state.championTeamId);
      this.writeClock(state);
    })();
  }

  private writeClock(state: LeagueState) {
    this.setMeta('season', String(state.date.season));
    this.setMeta('day', String(state.date.day));
    this.setMeta('rngState', String(state.rngState));
    this.setMeta('eventSeq', String(state.eventSeq));
    for (const k of Object.keys(JSON_META) as (keyof typeof JSON_META)[])
      this.setMeta(k, JSON.stringify(state[k]));
  }

  // ---------- queries ----------

  listEvents(limit: number, minImportance: Importance = 'minor'): LeagueEvent[] {
    const allowed = (Object.keys(IMPORTANCE_RANK) as Importance[]).filter(
      (k) => IMPORTANCE_RANK[k] >= IMPORTANCE_RANK[minImportance],
    );
    const rows = this.db
      .prepare(
        `SELECT payload_json FROM events WHERE importance IN (${allowed.map(() => '?').join(',')})
         ORDER BY seq DESC LIMIT ?`,
      )
      .all(...allowed, limit) as { payload_json: string }[];
    return rows.map((r) => JSON.parse(r.payload_json) as LeagueEvent);
  }

  /** Every award given, newest season first. Player names come from the players table (retired ones stay). */
  listAwards(): AwardEntry[] {
    const rows = this.db
      .prepare(
        `SELECT a.season, a.award, a.team_id, a.player_id, p.first_name, p.last_name
         FROM awards a LEFT JOIN players p ON p.id = a.player_id
         ORDER BY a.season DESC, a.rowid`,
      )
      .all() as {
      season: number;
      award: string;
      team_id: TeamId;
      player_id: PlayerId | null;
      first_name: string | null;
      last_name: string | null;
    }[];
    return rows.map((r) => ({
      season: r.season,
      award: r.award,
      teamId: r.team_id,
      ...(r.player_id
        ? { playerId: r.player_id, playerName: `${r.first_name} ${r.last_name}` }
        : {}),
    }));
  }

  listTeams(): Team[] {
    const rows = this.db.prepare('SELECT * FROM teams ORDER BY city').all() as {
      id: string;
      city: string;
      name: string;
      abbreviation: string;
      user_controlled: number;
      conference: string | null;
      division: string | null;
      gm_json: string | null;
      plan_json: string | null;
      coach_json: string | null;
      staff_json: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id as Team['id'],
      city: r.city,
      name: r.name,
      abbreviation: r.abbreviation,
      ...(r.conference ? { conference: r.conference } : {}),
      ...(r.division ? { division: r.division } : {}),
      userControlled: r.user_controlled === 1,
      ...(r.gm_json ? { gm: JSON.parse(r.gm_json) as NonNullable<Team['gm']> } : {}),
      ...(r.plan_json ? { plan: JSON.parse(r.plan_json) as NonNullable<Team['plan']> } : {}),
      ...(r.coach_json ? { coach: JSON.parse(r.coach_json) as NonNullable<Team['coach']> } : {}),
      ...(r.staff_json ? { staff: JSON.parse(r.staff_json) as NonNullable<Team['staff']> } : {}),
    }));
  }

  /** Active players; `withRetired` adds the ones who retired (for history such as records). */
  listPlayers(withRetired = false): Player[] {
    const rows = this.db
      .prepare(`SELECT * FROM players${withRetired ? '' : ' WHERE retired_season IS NULL'}`)
      .all() as PlayerRow[];
    return rows.map((r) => {
      const p: Player = {
        id: r.id as Player['id'],
        teamId: r.team_id as Player['teamId'],
        firstName: r.first_name,
        lastName: r.last_name,
        birthYear: r.birth_year,
        position: r.position,
        potential: r.potential,
        ratings: JSON.parse(r.ratings_json),
      };
      if (r.contract_json) p.contract = JSON.parse(r.contract_json);
      if (r.extension_json) p.extension = JSON.parse(r.extension_json);
      if (r.joined_season !== null) p.joined = r.joined_season;
      if (r.injured_until !== null) p.injuredUntil = r.injured_until;
      if (r.injury_count > 0) p.injuryHistory = { count: r.injury_count, days: r.injury_days };
      return p;
    });
  }

  /** Retired players with their archived seasons (for the Hall of Fame). */
  retiredCareers(): {
    id: PlayerId;
    name: string;
    position: string;
    retiredSeason: number;
    lines: Record<string, number>[];
  }[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.first_name, p.last_name, p.position, p.retired_season, s.stats_json
         FROM players p JOIN player_seasons s ON s.player_id = p.id
         WHERE p.retired_season IS NOT NULL ORDER BY p.id, s.season`,
      )
      .all() as {
      id: PlayerId;
      first_name: string;
      last_name: string;
      position: string;
      retired_season: number;
      stats_json: string;
    }[];
    const out = new Map<string, ReturnType<SaveFile['retiredCareers']>[number]>();
    for (const r of rows) {
      let p = out.get(r.id);
      if (!p) {
        p = {
          id: r.id,
          name: `${r.first_name} ${r.last_name}`,
          position: r.position,
          retiredSeason: r.retired_season,
          lines: [],
        };
        out.set(r.id, p);
      }
      p.lines.push(JSON.parse(r.stats_json) as Record<string, number>);
    }
    return [...out.values()];
  }

  /** A player's archived regular seasons, oldest first. */
  careerLines(playerId: string): CareerLine[] {
    const rows = this.db
      .prepare(
        'SELECT season, team_id, stats_json FROM player_seasons WHERE player_id = ? ORDER BY season',
      )
      .all(playerId) as { season: number; team_id: TeamId | null; stats_json: string }[];
    return rows.map((r) => ({
      season: r.season,
      teamId: r.team_id,
      stats: JSON.parse(r.stats_json) as Record<string, number>,
    }));
  }

  /**
   * A team's settlements (each one's revenue and costs) and owner meetings, oldest first: the
   * Owner screen's money flow and history.
   */
  ownerHistory(teamId: TeamId): {
    money: { season: number; day: number; revenue: number; costs: number }[];
    meetings: OwnerReport['meetings'];
  } {
    const rows = this.db
      .prepare(
        `SELECT payload_json FROM events
         WHERE kind IN ('finance.settled', 'owner.meeting') AND team_ids = ? ORDER BY seq`,
      )
      .all(JSON.stringify([teamId])) as { payload_json: string }[];
    const sum = (lines: Record<string, number>) => Object.values(lines).reduce((a, b) => a + b, 0);
    const money: { season: number; day: number; revenue: number; costs: number }[] = [];
    const meetings: OwnerReport['meetings'] = [];
    for (const r of rows) {
      const e = JSON.parse(r.payload_json) as LeagueEvent;
      if (e.kind === 'finance.settled') {
        money.push({ ...e.date, revenue: sum(e.revenue), costs: sum(e.costs) });
      } else if (e.kind === 'owner.meeting') {
        const { season, objectives, confidence } = e.owner;
        meetings.push({ season, meeting: e.meeting, objectives, confidence });
      }
    }
    return { money, meetings };
  }

  /** A player's awards and the contract / team moves recorded in the event log, oldest first. */
  playerHistory(id: string): PlayerHistory {
    const playerId = id as PlayerId;
    const rows = this.db
      .prepare(
        `SELECT season, payload_json FROM events
         WHERE kind IN ('player.drafted', 'player.signed', 'contract.extended', 'trade.completed',
                        'contract.boughtOut', 'contract.expired')
           AND payload_json LIKE ? ORDER BY seq`,
      )
      .all(`%"${id}"%`) as { season: number; payload_json: string }[];
    const moves: PlayerMove[] = [];
    for (const r of rows) {
      const e = JSON.parse(r.payload_json) as LeagueEvent;
      const season = r.season;
      switch (e.kind) {
        case 'player.drafted':
          if (e.player.id === playerId && e.player.teamId) {
            moves.push({ season, kind: 'drafted', teamId: e.player.teamId });
          }
          break;
        case 'player.signed':
          if (e.playerId === playerId) {
            moves.push({ season, kind: 'signed', teamId: e.teamId, capHit: e.contract.capHit });
          }
          break;
        case 'contract.extended':
          if (e.playerId === playerId) {
            moves.push({ season, kind: 'extended', teamId: e.teamId, capHit: e.contract.capHit });
          }
          break;
        case 'trade.completed':
          // `give` goes to `toTeamId`, `get` comes to `fromTeamId`.
          if (e.give.includes(playerId)) moves.push({ season, kind: 'traded', teamId: e.toTeamId });
          else if (e.get.includes(playerId)) {
            moves.push({ season, kind: 'traded', teamId: e.fromTeamId });
          }
          break;
        case 'contract.boughtOut':
          if (e.playerId === playerId) moves.push({ season, kind: 'boughtOut', teamId: e.teamId });
          break;
        case 'contract.expired':
          // Emitted with the team he was under contract to as its only `teamIds` entry.
          if (e.playerId === playerId && e.teamIds[0]) {
            moves.push({ season, kind: 'expired', teamId: e.teamIds[0] });
          }
          break;
        default:
          break;
      }
    }
    const awards = this.listAwards()
      .filter((a) => a.playerId === playerId)
      .map((a) => ({ season: a.season, award: a.award }))
      .reverse();
    return { awards, moves };
  }

  /** Seasons that have a champion, oldest first. */
  finishedSeasons(): number[] {
    const rows = this.db
      .prepare("SELECT season FROM awards WHERE award = 'champion' ORDER BY season")
      .all() as { season: number }[];
    return rows.map((r) => r.season);
  }

  playedResults(season: number): GameResult[] {
    const rows = this.db
      .prepare(
        `SELECT id, home_team_id AS homeTeamId, away_team_id AS awayTeamId, home_score AS homeScore,
                away_score AS awayScore, overtime, stats_json, box_json, playoff_series_id
         FROM games WHERE season = ? AND played = 1 ORDER BY day, rowid`,
      )
      .all(season) as (Omit<GameResult, 'overtime' | 'stats'> & {
      overtime: number;
      stats_json: string | null;
      box_json: string | null;
      playoff_series_id: string | null;
    })[];
    return rows.map(({ stats_json, box_json, playoff_series_id, ...r }) => ({
      ...r,
      overtime: r.overtime === 1,
      stats: stats_json ? JSON.parse(stats_json) : {},
      ...(box_json ? { box: JSON.parse(box_json) } : {}),
      ...(playoff_series_id ? { playoffSeriesId: playoff_series_id } : {}),
    }));
  }
}
