import Database from 'better-sqlite3';
import type { GameResult, Player, Team, TeamId } from '@gm/shared';
import { migrations } from './migrations';

export type Db = Database.Database;

/**
 * Opens (or creates) a save file. One league = one .sqlite file, which keeps
 * Steam Cloud sync and "copy your save to a friend" simple.
 * Pass ':memory:' in tests.
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

export interface ScheduledGameRow {
  id: string;
  day: number;
  homeTeamId: TeamId;
  awayTeamId: TeamId;
}

/** All database access goes through here. The UI and sim never write SQL. */
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

  insertLeague(teams: readonly Team[], players: readonly Player[]) {
    const insertTeam = this.db.prepare(
      'INSERT INTO teams (id, city, name, abbreviation, user_controlled) VALUES (@id, @city, @name, @abbreviation, @userControlled)',
    );
    const insertPlayer = this.db.prepare(
      `INSERT INTO players (id, team_id, first_name, last_name, birth_year, position, potential, ratings_json, contract_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      for (const t of teams) insertTeam.run({ ...t, userControlled: t.userControlled ? 1 : 0 });
      for (const p of players) {
        insertPlayer.run(
          p.id,
          p.teamId,
          p.firstName,
          p.lastName,
          p.birthYear,
          p.position,
          p.potential,
          JSON.stringify(p.skater ?? p.goalie ?? {}),
          p.contract ? JSON.stringify(p.contract) : null,
        );
      }
    })();
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
      const ratings = JSON.parse(r.ratings_json);
      const p: Player = {
        id: r.id as Player['id'],
        teamId: r.team_id as Player['teamId'],
        firstName: r.first_name,
        lastName: r.last_name,
        birthYear: r.birth_year,
        position: r.position,
        potential: r.potential,
      };
      if (r.position === 'G') p.goalie = ratings;
      else p.skater = ratings;
      if (r.contract_json) p.contract = JSON.parse(r.contract_json);
      return p;
    });
  }

  insertSchedule(season: number, games: readonly ScheduledGameRow[]) {
    const stmt = this.db.prepare(
      'INSERT INTO games (id, season, day, home_team_id, away_team_id) VALUES (?, ?, ?, ?, ?)',
    );
    this.db.transaction(() => {
      for (const g of games) stmt.run(g.id, season, g.day, g.homeTeamId, g.awayTeamId);
    })();
  }

  /** Unplayed games for the next `days` game days. */
  nextUnplayed(season: number, days: number): ScheduledGameRow[] {
    const first = this.db
      .prepare('SELECT MIN(day) AS d FROM games WHERE season = ? AND played = 0')
      .get(season) as { d: number | null };
    if (first.d === null) return [];
    return this.db
      .prepare(
        `SELECT id, day, home_team_id AS homeTeamId, away_team_id AS awayTeamId
         FROM games WHERE season = ? AND played = 0 AND day < ? ORDER BY day, id`,
      )
      .all(season, first.d + days) as ScheduledGameRow[];
  }

  playedResults(season: number): GameResult[] {
    const rows = this.db
      .prepare(
        `SELECT id, home_team_id AS homeTeamId, away_team_id AS awayTeamId, home_goals AS homeGoals,
                away_goals AS awayGoals, overtime, shootout, home_shots AS homeShots, away_shots AS awayShots
         FROM games WHERE season = ? AND played = 1 ORDER BY day, id`,
      )
      .all(season) as (Omit<GameResult, 'overtime' | 'shootout'> & {
      overtime: number;
      shootout: number;
    })[];
    return rows.map((r) => ({ ...r, overtime: r.overtime === 1, shootout: r.shootout === 1 }));
  }

  recordResults(results: readonly GameResult[]) {
    const stmt = this.db.prepare(
      `UPDATE games SET played = 1, home_goals = ?, away_goals = ?, overtime = ?, shootout = ?, home_shots = ?, away_shots = ?
       WHERE id = ?`,
    );
    this.db.transaction(() => {
      for (const r of results) {
        stmt.run(
          r.homeGoals,
          r.awayGoals,
          r.overtime ? 1 : 0,
          r.shootout ? 1 : 0,
          r.homeShots,
          r.awayShots,
          r.id,
        );
      }
    })();
  }
}
