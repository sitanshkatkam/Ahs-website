-- One row per device.
--
-- The alarm times stay as a JSON array rather than becoming their own table.
-- A row per alarm would be the tidier schema, but a device plans ~150 alarms a
-- month and re-registers daily, so it would write ~150 rows per student per day
-- and burn D1's free allowance of 100,000 row-writes an order of magnitude
-- faster than this does. Here a registration is one row.
--
-- `next_at` is the part that has to be a real column: it's the only thing the
-- per-minute cron needs to look at, and indexing it means a tick reads the
-- handful of devices that are actually due instead of every row in the table.
CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh   TEXT NOT NULL,
  auth     TEXT NOT NULL,
  -- JSON array of epoch ms, ascending.
  times    TEXT NOT NULL DEFAULT '[]',
  -- First entry of `times` still ahead of us; NULL once they're all spent.
  next_at  INTEGER,
  updated  INTEGER NOT NULL
);

-- Partial: a device with nothing pending is dead weight in the index, and most
-- rows are in that state most of the time. The cron's WHERE clause is written
-- to match this exactly so the planner can use it.
CREATE INDEX IF NOT EXISTS idx_subscriptions_next_at
  ON subscriptions (next_at) WHERE next_at IS NOT NULL;
