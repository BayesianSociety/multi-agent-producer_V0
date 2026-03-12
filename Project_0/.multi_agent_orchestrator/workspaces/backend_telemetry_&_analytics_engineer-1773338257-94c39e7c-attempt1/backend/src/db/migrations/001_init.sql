PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  display_name TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  user_agent TEXT,
  locale TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS puzzles (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  concepts TEXT NOT NULL,
  version TEXT NOT NULL,
  checksum TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  puzzle_id INTEGER REFERENCES puzzles(id) ON DELETE SET NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  result TEXT NOT NULL CHECK(result IN ('success','failure','aborted')),
  failure_reason TEXT,
  code_snapshot_json TEXT NOT NULL,
  block_count INTEGER NOT NULL,
  execution_steps INTEGER NOT NULL,
  client_version TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempts_session ON attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_attempts_puzzle_result ON attempts(puzzle_id, result);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT,
  attempt_id TEXT,
  puzzle_id INTEGER,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(attempt_id) REFERENCES attempts(id) ON DELETE SET NULL,
  FOREIGN KEY(puzzle_id) REFERENCES puzzles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_attempt_ts ON events(attempt_id, ts);

CREATE TABLE IF NOT EXISTS movements (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  entity TEXT NOT NULL,
  from_x INTEGER NOT NULL,
  from_y INTEGER NOT NULL,
  to_x INTEGER NOT NULL,
  to_y INTEGER NOT NULL,
  direction TEXT,
  cause TEXT NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_movements_attempt_ts ON movements(attempt_id, ts);

CREATE TABLE IF NOT EXISTS puzzle_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_id INTEGER NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  completed_at INTEGER,
  best_attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  PRIMARY KEY(user_id, puzzle_id)
);
CREATE INDEX IF NOT EXISTS idx_progress_user ON puzzle_progress(user_id);
