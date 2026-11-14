/**
 * Schema migrations, applied in order. NEVER edit a migration that has shipped:
 * players' save files already ran it. Add a new one instead.
 * The save's current version is stored in SQLite's `user_version` pragma.
 */
export const migrations: readonly string[] = [
  // 1: initial schema
  `
  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE teams (
    id TEXT PRIMARY KEY,
    city TEXT NOT NULL,
    name TEXT NOT NULL,
    abbreviation TEXT NOT NULL,
    user_controlled INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE players (
    id TEXT PRIMARY KEY,
    team_id TEXT REFERENCES teams(id),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    birth_year INTEGER NOT NULL,
    position TEXT NOT NULL,
    potential INTEGER NOT NULL,
    -- Ratings and contract as JSON keeps the schema stable while the rating model evolves.
    ratings_json TEXT NOT NULL,
    contract_json TEXT
  );
  CREATE INDEX players_team ON players(team_id);

  CREATE TABLE games (
    id TEXT PRIMARY KEY,
    season INTEGER NOT NULL,
    day INTEGER NOT NULL,
    home_team_id TEXT NOT NULL REFERENCES teams(id),
    away_team_id TEXT NOT NULL REFERENCES teams(id),
    played INTEGER NOT NULL DEFAULT 0,
    home_goals INTEGER,
    away_goals INTEGER,
    overtime INTEGER,
    shootout INTEGER,
    home_shots INTEGER,
    away_shots INTEGER
  );
  CREATE INDEX games_season_day ON games(season, day);
  `,

  // 2: event log + team status. Everything that happens is an event (see @gm/shared events).
  `
  CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    season INTEGER NOT NULL,
    day INTEGER NOT NULL,
    kind TEXT NOT NULL,
    importance TEXT NOT NULL,
    team_ids TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );
  CREATE INDEX events_importance ON events(importance, seq);

  ALTER TABLE teams ADD COLUMN status TEXT NOT NULL DEFAULT 'bubble';
  `,
];
