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
  // 6: league structure (optional: roster files without it play a flat schedule).
  `
  ALTER TABLE teams ADD COLUMN conference TEXT;
  ALTER TABLE teams ADD COLUMN division TEXT;
  `,
  // 7: box score (player lines and shots) of each played game, as JSON.
  `
  ALTER TABLE games ADD COLUMN box_json TEXT;
  `,
  // 8: injured players are out until this day of the season (NULL = healthy).
  `
  ALTER TABLE players ADD COLUMN injured_until INTEGER;
  `,
  // 9: skaters gained a \`faceoffs\` rating (docs/RATINGS.md). Start it at the average of the other
  // seven so nobody's overall moves.
  `
  UPDATE players SET ratings_json = json_set(ratings_json, '$.faceoffs', CAST(ROUND((
      json_extract(ratings_json, '$.skating') + json_extract(ratings_json, '$.shooting') +
      json_extract(ratings_json, '$.passing') + json_extract(ratings_json, '$.puckHandling') +
      json_extract(ratings_json, '$.defense') + json_extract(ratings_json, '$.physical') +
      json_extract(ratings_json, '$.hockeyIq')) / 7.0) AS INTEGER))
  WHERE position <> 'G' AND json_extract(ratings_json, '$.faceoffs') IS NULL;
  `,
  // 10: dead cap (buyouts) a team owes in a season. Rows for past seasons are deleted.
  `
  CREATE TABLE IF NOT EXISTS cap_charges (
    team_id TEXT NOT NULL REFERENCES teams(id),
    player_id TEXT NOT NULL REFERENCES players(id),
    kind TEXT NOT NULL,
    season INTEGER NOT NULL,
    amount INTEGER NOT NULL
  );
  `,
  // 11: each player's regular-season stat line, archived when the season ends (career stats).
  `
  CREATE TABLE IF NOT EXISTS player_seasons (
    player_id TEXT NOT NULL,
    season INTEGER NOT NULL,
    team_id TEXT,
    stats_json TEXT NOT NULL,
    PRIMARY KEY (player_id, season)
  );
  `,
  // 12: an in-season extension waiting for the current contract to end.
  `
  ALTER TABLE players ADD COLUMN extension_json TEXT;
  `,
  // 13: the season a player joined his current team (chemistry). NULL = since the league began.
  `
  ALTER TABLE players ADD COLUMN joined_season INTEGER;
  `,
  // 14: the AI GM running each team (style and skill). NULL = derived from the team id.
  `
  ALTER TABLE teams ADD COLUMN gm_json TEXT;
  `,
  // 15: the AI GM's plan for his team (contend, retool, rebuild). NULL = none yet.
  `
  ALTER TABLE teams ADD COLUMN plan_json TEXT;
  `,
  // 16: career injuries and days missed (injury history).
  `
  ALTER TABLE players ADD COLUMN injury_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE players ADD COLUMN injury_days INTEGER NOT NULL DEFAULT 0;
  `,
  // 17: events by kind (the Owner screen reads a team's settlements and meetings).
  `
  CREATE INDEX IF NOT EXISTS events_kind ON events(kind, seq);
  `,
  // 18: each team's head coach. NULL = derived from the team id.
  `
  ALTER TABLE teams ADD COLUMN coach_json TEXT;
  `,
  // 19: each team's front-office department heads. NULL = all derived from the team id.
  `
  ALTER TABLE teams ADD COLUMN staff_json TEXT;
  `,
  // 20: a player's first main-league season (the rookie award). NULL = in the league from before
  // the prospect pool. Unsigned prospects have no row yet: they live in the meta table.
  `
  ALTER TABLE players ADD COLUMN debut_season INTEGER;
  `,
  // 21: a relocated team's market size. NULL = derived from the team id.
  `
  ALTER TABLE teams ADD COLUMN market REAL;
  `,
  // 22: lower-league seasons (junior, Europe): draft-year lines and prospects' seasons. Apart from
  // player_seasons, so a season can have both and career totals stay main-league only.
  `
  CREATE TABLE IF NOT EXISTS player_league_seasons (
    player_id TEXT NOT NULL,
    season INTEGER NOT NULL,
    league TEXT NOT NULL,
    stats_json TEXT NOT NULL,
    PRIMARY KEY (player_id, season, league)
  );
  `,
];
