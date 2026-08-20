-- Google sign-in.
--
-- Accounts are optional and additive: the app works exactly as before without
-- one. Nothing in the schedule, classes or notification path reads these
-- tables — they exist so that a future feature (sharing a schedule with a
-- classmate) has a stable identity to hang off.
CREATE TABLE IF NOT EXISTS users (
  -- Google's 'sub' claim. Stable for the life of the account, and unlike the
  -- email address it never changes hands.
  id        TEXT PRIMARY KEY,
  email     TEXT NOT NULL,
  name      TEXT,
  picture   TEXT,
  created   INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- Only the SHA-256 of the cookie value is stored, never the value itself, so
-- read access to this table doesn't let anyone impersonate a student.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created    INTEGER NOT NULL,
  expires    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires);
