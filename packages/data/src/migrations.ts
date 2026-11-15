/**
 * Schema migrations, applied in order. NEVER edit a migration once a public build has
 * shipped: players' save files already ran it. Add a new one instead.
 * (Pre-release, until the first public build, editing is OK; old dev saves are simply recreated.)
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
    -- Ratings (sport-specific keys) and contract as JSON keep the schema the same for every sport.
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
    home_score INTEGER,
    away_score INTEGER,
    overtime INTEGER,
    -- Sport-specific box-score numbers (hockey: shots, shootout) as JSON.
    stats_json TEXT
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
  // 3: playoff game identity and series state.
  `
  ALTER TABLE games ADD COLUMN playoff_series_id TEXT;
  CREATE TABLE playoff_series (
    id TEXT PRIMARY KEY,
    round INTEGER NOT NULL,
    higher_seed INTEGER NOT NULL,
    lower_seed INTEGER NOT NULL,
    higher_team_id TEXT NOT NULL REFERENCES teams(id),
    lower_team_id TEXT NOT NULL REFERENCES teams(id),
    higher_wins INTEGER NOT NULL DEFAULT 0,
    lower_wins INTEGER NOT NULL DEFAULT 0,
    winner_team_id TEXT REFERENCES teams(id)
  );
  `,
  // 4: retired players stay in the table (career history later) but leave the league.
  `
  ALTER TABLE players ADD COLUMN retired_season INTEGER;
  `,
  // 5: end-of-season awards. player_id is NULL for team awards (champion).
  `
  CREATE TABLE awards (
    season INTEGER NOT NULL,
    award TEXT NOT NULL,
    team_id TEXT NOT NULL REFERENCES teams(id),
    player_id TEXT REFERENCES players(id),
    PRIMARY KEY (season, award)
  );
  `,
];
