import Database from 'better-sqlite3';
import type {
  GameResult,
  Importance,
  LeagueEvent,
  Player,
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
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

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
      'INSERT INTO teams (id, city, name, abbreviation, user_controlled, status) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const insertPlayer = this.db.prepare(
      `INSERT INTO players (id, team_id, first_name, last_name, birth_year, position, potential, ratings_json, contract_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertGame = this.db.prepare(
      'INSERT INTO games (id, season, day, home_team_id, away_team_id) VALUES (?, ?, ?, ?, ?)',
    );
    this.db.transaction(() => {
      for (const t of Object.values(state.teams)) {
        insertTeam.run(
          t.id,
          t.city,
          t.name,
          t.abbreviation,
          t.userControlled ? 1 : 0,
          state.teamStatus[t.id] ?? 'bubble',
        );
      }
      for (const p of Object.values(state.players)) {
        insertPlayer.run(
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
      for (const g of state.schedule)
        insertGame.run(g.id, g.date.season, g.date.day, g.homeTeamId, g.awayTeamId);
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
    };
  }

  /** Stores events and the rows they changed, in one transaction. */
  persist(events: readonly LeagueEvent[], state: LeagueState) {
    const insertEvent = this.db.prepare(
      `INSERT INTO events (id, season, day, kind, importance, team_ids, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const recordGame = this.db.prepare(
      `UPDATE games SET played = 1, home_score = ?, away_score = ?, overtime = ?, stats_json = ? WHERE id = ?`,
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
    const setStatus = this.db.prepare('UPDATE teams SET status = ? WHERE id = ?');
    const setControl = this.db.prepare('UPDATE teams SET user_controlled = ? WHERE id = ?');

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
            JSON.stringify(e),
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
          case 'team.statusChanged':
            setStatus.run(e.to, e.teamId);
            break;
          case 'team.controlChanged':
            setControl.run(e.userControlled ? 1 : 0, e.teamId);
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

  listTeams(): Team[] {
    const rows = this.db.prepare('SELECT * FROM teams ORDER BY city').all() as {
      id: string;
      city: string;
      name: string;
      abbreviation: string;
      user_controlled: number;
    }[];
    return rows.map((r) => ({
      id: r.id as Team['id'],
      city: r.city,
      name: r.name,
      abbreviation: r.abbreviation,
      userControlled: r.user_controlled === 1,
    }));
  }

  listPlayers(): Player[] {
    const rows = this.db.prepare('SELECT * FROM players').all() as PlayerRow[];
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
      return p;
    });
  }

  playedResults(season: number): GameResult[] {
    const rows = this.db
      .prepare(
        `SELECT id, home_team_id AS homeTeamId, away_team_id AS awayTeamId, home_score AS homeScore,
                away_score AS awayScore, overtime, stats_json, playoff_series_id
         FROM games WHERE season = ? AND played = 1 ORDER BY day, rowid`,
      )
      .all(season) as (Omit<GameResult, 'overtime' | 'stats'> & {
      overtime: number;
      stats_json: string | null;
      playoff_series_id: string | null;
    })[];
    return rows.map(({ stats_json, playoff_series_id, ...r }) => ({
      ...r,
      overtime: r.overtime === 1,
      stats: stats_json ? JSON.parse(stats_json) : {},
      ...(playoff_series_id ? { playoffSeriesId: playoff_series_id } : {}),
    }));
  }
}
