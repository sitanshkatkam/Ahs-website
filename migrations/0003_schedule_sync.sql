-- Cross-device sync of the schedule, and only the schedule.
--
-- Classes, grade level, zero/seventh period and any schedule corrections the
-- student added. Deliberately NOT their grades or assignments: those are the
-- sensitive half, nobody needs them on two devices, and keeping them on the
-- phone is what lets the privacy page keep saying so.
--
-- One row per account, holding a JSON blob rather than a column per field. The
-- shape of a student's schedule is the app's business and changes with it; a
-- normalised table here would mean a migration every time a field is added,
-- for data the server never reads or reasons about. It is opaque storage.
CREATE TABLE IF NOT EXISTS schedules (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  data    TEXT NOT NULL,
  -- When the *student* last changed it, not when the row was written. This is
  -- what decides which side wins when two devices disagree.
  updated INTEGER NOT NULL
);
