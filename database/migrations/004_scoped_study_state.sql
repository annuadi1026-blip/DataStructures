-- Introduce server-authoritative solo/squad study state without changing
-- historical progress, assignments, memberships, or question records.

ALTER TABLE users
  ADD COLUMN active_group_id UUID,
  ADD CONSTRAINT users_active_group_pair_uq UNIQUE (active_group_id, id),
  ADD CONSTRAINT users_active_group_membership_fk
    FOREIGN KEY (active_group_id, id)
    REFERENCES group_members (group_id, user_id)
    ON DELETE SET NULL (active_group_id);

ALTER TABLE groups
  ADD COLUMN current_study_day INTEGER,
  ADD COLUMN study_initialized BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN study_paused BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN last_advanced_on DATE,
  ADD COLUMN pause_started_at TIMESTAMPTZ,
  ADD COLUMN resumed_at TIMESTAMPTZ,
  ADD COLUMN study_state_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD CONSTRAINT groups_current_study_day_positive
    CHECK (current_study_day IS NULL OR current_study_day > 0),
  ADD CONSTRAINT groups_study_initialized_day_check
    CHECK (NOT study_initialized OR current_study_day IS NOT NULL);

CREATE TABLE solo_study_states (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_study_day INTEGER,
  study_initialized BOOLEAN NOT NULL DEFAULT false,
  study_paused BOOLEAN NOT NULL DEFAULT false,
  last_advanced_on DATE,
  pause_started_at TIMESTAMPTZ,
  resumed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT solo_current_study_day_positive
    CHECK (current_study_day IS NULL OR current_study_day > 0),
  CONSTRAINT solo_study_initialized_day_check
    CHECK (NOT study_initialized OR current_study_day IS NOT NULL)
);

CREATE TABLE group_study_day_questions (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  study_day INTEGER NOT NULL CHECK (study_day > 0),
  position SMALLINT NOT NULL CHECK (position IN (1, 2)),
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, study_day, position),
  UNIQUE (group_id, study_day, question_id)
);

CREATE TABLE solo_study_day_questions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  study_day INTEGER NOT NULL CHECK (study_day > 0),
  position SMALLINT NOT NULL CHECK (position IN (1, 2)),
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, study_day, position),
  UNIQUE (user_id, study_day, question_id)
);

-- Per-user/per-calendar-day status for scope assignments. Unlike legacy
-- daily_assignments this allows the same question to appear in a later scope
-- day without rewriting or colliding with historical assignment rows.
CREATE TABLE study_day_daily_assignments (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('SOLO', 'SQUAD')),
  scope_id UUID NOT NULL,
  assignment_date DATE NOT NULL,
  study_day INTEGER NOT NULL CHECK (study_day > 0),
  position SMALLINT NOT NULL CHECK (position IN (1, 2)),
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, assignment_date, scope_type, scope_id, position),
  UNIQUE (user_id, assignment_date, scope_type, scope_id, question_id)
);
CREATE INDEX study_day_daily_assignments_date_idx
  ON study_day_daily_assignments (assignment_date, user_id);

-- One row per user/date is enough to break a streak, including a pause that
-- starts on Sunday. Group pauses are recorded for each current member.
CREATE TABLE study_pause_days (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pause_date DATE NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('SOLO', 'SQUAD')),
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pause_date),
  CHECK ((scope_type = 'SOLO' AND group_id IS NULL) OR
         (scope_type = 'SQUAD' AND group_id IS NOT NULL))
);

-- Backfill solo state from the exact legacy day calculation used by /daily.
WITH legacy_days AS (
  SELECT u.id AS user_id,
         count(DISTINCT da.assignment_date)::INTEGER AS study_day
  FROM users u
  LEFT JOIN daily_assignments da
    ON da.user_id = u.id
   AND da.assignment_date <= CURRENT_DATE
   AND EXTRACT(DOW FROM da.assignment_date) <> 0
  GROUP BY u.id
)
INSERT INTO solo_study_states
  (user_id, current_study_day, study_initialized, last_advanced_on)
SELECT user_id, NULLIF(study_day, 0), study_day > 0,
       CASE WHEN study_day > 0 THEN CURRENT_DATE ELSE NULL END
FROM legacy_days;

-- Exactly-one-membership users are safe to activate automatically. Users with
-- zero or multiple memberships remain in Solo Mode until explicit selection.
WITH membership_counts AS (
  SELECT u.id AS user_id, count(gm.group_id)::INTEGER AS memberships,
         min(gm.group_id::TEXT)::UUID AS only_group_id
  FROM users u
  LEFT JOIN group_members gm ON gm.user_id = u.id
  GROUP BY u.id
)
UPDATE users u
SET active_group_id = mc.only_group_id
FROM membership_counts mc
WHERE mc.user_id = u.id AND mc.memberships = 1;

-- A group's initial day is the lowest non-zero legacy day among its current
-- members. Empty or uninitialized groups are deliberately left uninitialized.
WITH legacy_days AS (
  SELECT gm.group_id, gm.user_id,
         count(DISTINCT da.assignment_date)::INTEGER AS study_day
  FROM group_members gm
  LEFT JOIN daily_assignments da
    ON da.user_id = gm.user_id
   AND da.assignment_date <= CURRENT_DATE
   AND EXTRACT(DOW FROM da.assignment_date) <> 0
  GROUP BY gm.group_id, gm.user_id
), group_days AS (
  SELECT group_id, min(study_day) FILTER (WHERE study_day > 0) AS study_day
  FROM legacy_days
  GROUP BY group_id
)
UPDATE groups g
SET current_study_day = gd.study_day,
    study_initialized = COALESCE(gd.study_day > 0, false),
    last_advanced_on = CASE WHEN gd.study_day > 0 THEN CURRENT_DATE ELSE NULL END,
    study_state_updated_at = now()
FROM group_days gd
WHERE gd.group_id = g.id;

-- Preserve each user's previous assigned question order as their solo mapping.
WITH day_numbers AS (
  SELECT user_id, assignment_date,
         row_number() OVER (PARTITION BY user_id ORDER BY assignment_date)::INTEGER AS study_day
  FROM (
    SELECT DISTINCT user_id, assignment_date
    FROM daily_assignments
    WHERE assignment_date <= CURRENT_DATE AND EXTRACT(DOW FROM assignment_date) <> 0
  ) dates
)
INSERT INTO solo_study_day_questions (user_id, study_day, position, question_id)
SELECT dn.user_id, dn.study_day, da.position, da.question_id
FROM day_numbers dn
JOIN daily_assignments da USING (user_id, assignment_date)
WHERE da.assignment_date <= CURRENT_DATE AND EXTRACT(DOW FROM da.assignment_date) <> 0
ON CONFLICT DO NOTHING;

-- For existing squads, use a member at the lowest legacy day as the mapping
-- source. The preflight script rejects tied lowest members with divergent maps.
WITH legacy_days AS (
  SELECT gm.group_id, gm.user_id, gm.joined_at,
         count(DISTINCT da.assignment_date)::INTEGER AS study_day
  FROM group_members gm
  LEFT JOIN daily_assignments da
    ON da.user_id = gm.user_id
   AND da.assignment_date <= CURRENT_DATE
   AND EXTRACT(DOW FROM da.assignment_date) <> 0
  GROUP BY gm.group_id, gm.user_id, gm.joined_at
), representatives AS (
  SELECT DISTINCT ON (group_id) group_id, user_id
  FROM legacy_days
  WHERE study_day > 0
  ORDER BY group_id, study_day, joined_at, user_id
), day_numbers AS (
  SELECT user_id, assignment_date,
         row_number() OVER (PARTITION BY user_id ORDER BY assignment_date)::INTEGER AS study_day
  FROM (
    SELECT DISTINCT da.user_id, da.assignment_date
    FROM daily_assignments da
    WHERE da.assignment_date <= CURRENT_DATE
      AND EXTRACT(DOW FROM da.assignment_date) <> 0
  ) dates
)
INSERT INTO group_study_day_questions (group_id, study_day, position, question_id)
SELECT r.group_id, dn.study_day, da.position, da.question_id
FROM representatives r
JOIN day_numbers dn ON dn.user_id = r.user_id
JOIN daily_assignments da
  ON da.user_id = dn.user_id AND da.assignment_date = dn.assignment_date
WHERE dn.study_day <= (SELECT g.current_study_day FROM groups g WHERE g.id = r.group_id)
ON CONFLICT DO NOTHING;
