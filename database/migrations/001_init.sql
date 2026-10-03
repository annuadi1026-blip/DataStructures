-- DSA Squad initial schema (plain PostgreSQL, Supabase compatible)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL,
  username       TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  token_version  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));
CREATE UNIQUE INDEX users_username_lower_uq ON users (lower(username));

CREATE TABLE groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON group_members (user_id);

CREATE TABLE group_invites (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  code           TEXT NOT NULL UNIQUE,
  invited_email  TEXT,
  created_by     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at     TIMESTAMPTZ NOT NULL,
  max_uses       INTEGER NOT NULL DEFAULT 20 CHECK (max_uses > 0),
  uses           INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX group_invites_group_idx ON group_invites (group_id);

CREATE TABLE questions (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  topic           TEXT NOT NULL,
  roadmap_order   INTEGER NOT NULL,  -- order of the topic in the roadmap (configurable)
  question_order  INTEGER NOT NULL,  -- order of the question inside its topic
  in_neetcode     BOOLEAN NOT NULL DEFAULT false,
  in_striver      BOOLEAN NOT NULL DEFAULT false,
  source_note     TEXT,              -- note printed in the source PDF, if any
  difficulty      TEXT CHECK (difficulty IN ('Easy','Medium','Hard')), -- not in the PDF; null unless set later
  description     TEXT,              -- not in the PDF; null unless set later
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (in_neetcode OR in_striver)
);
CREATE UNIQUE INDEX questions_roadmap_uq ON questions (roadmap_order, question_order);
CREATE INDEX questions_topic_idx ON questions (topic);

CREATE TABLE question_sources (
  id           SERIAL PRIMARY KEY,
  question_id  INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('leetcode','neetcode','striver','youtube')),
  url          TEXT NOT NULL,
  UNIQUE (question_id, kind)
);

CREATE TABLE solution_approaches (
  id                SERIAL PRIMARY KEY,
  question_id       INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL DEFAULT 1,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  algorithm         TEXT,
  time_complexity   TEXT,
  space_complexity  TEXT,
  code              TEXT,
  provided_by       TEXT NOT NULL DEFAULT 'application' CHECK (provided_by IN ('application','source')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, position)
);

CREATE TABLE user_question_progress (
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id       INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'NOT_STARTED'
                    CHECK (status IN ('NOT_STARTED','ATTEMPTED','SOLVED','NEEDS_REVISION','REVISED')),
  attempted_at      TIMESTAMPTZ,
  solved_at         TIMESTAMPTZ,
  last_revised_at   TIMESTAMPTZ,
  next_revision_at  DATE,
  revision_count    INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX uqp_status_idx ON user_question_progress (user_id, status);
CREATE INDEX uqp_next_rev_idx ON user_question_progress (user_id, next_revision_at);

CREATE TABLE user_solutions (
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id       INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  approach          TEXT NOT NULL DEFAULT '',
  code              TEXT NOT NULL DEFAULT '',
  time_complexity   TEXT NOT NULL DEFAULT '',
  space_complexity  TEXT NOT NULL DEFAULT '',
  mistakes          TEXT NOT NULL DEFAULT '',
  learned           TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);

CREATE TABLE shared_solutions (
  user_id          UUID NOT NULL,
  question_id      INTEGER NOT NULL,
  group_id         UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  share_approach   BOOLEAN NOT NULL DEFAULT true,
  share_code       BOOLEAN NOT NULL DEFAULT true,
  share_explanation BOOLEAN NOT NULL DEFAULT true, -- complexity + what I learned
  share_notes      BOOLEAN NOT NULL DEFAULT false, -- mistakes
  shared_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id, group_id),
  FOREIGN KEY (user_id, question_id) REFERENCES user_solutions(user_id, question_id) ON DELETE CASCADE
);

CREATE TABLE daily_assignments (
  id               BIGSERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_date  DATE NOT NULL,
  question_id      INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position         SMALLINT NOT NULL CHECK (position IN (1, 2)),  -- exactly 2 slots per day
  completed        BOOLEAN NOT NULL DEFAULT false,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, assignment_date, position),
  UNIQUE (user_id, question_id)  -- a question is never assigned twice to a user
);
CREATE INDEX daily_assignments_date_idx ON daily_assignments (assignment_date, user_id);

CREATE TABLE revisions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  stage         INTEGER NOT NULL CHECK (stage >= 1),
  due_date      DATE NOT NULL,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, question_id, stage)
);
CREATE INDEX revisions_due_idx ON revisions (user_id, due_date) WHERE completed_at IS NULL;

CREATE TABLE notification_preferences (
  user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  personal_daily_reminder BOOLEAN NOT NULL DEFAULT true,
  friend_pending          BOOLEAN NOT NULL DEFAULT true,
  friend_completed        BOOLEAN NOT NULL DEFAULT true,
  allow_nudges            BOOLEAN NOT NULL DEFAULT true,
  daily_group_summary     BOOLEAN NOT NULL DEFAULT true,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id                  BIGSERIAL PRIMARY KEY,
  recipient_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  type                TEXT NOT NULL CHECK (type IN ('PERSONAL_DAILY_REMINDER','FRIEND_DAILY_PENDING',
                        'FRIEND_DAILY_COMPLETED','FRIEND_NUDGE','REVISION_DUE','DAILY_GROUP_SUMMARY')),
  message             TEXT NOT NULL,
  related_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  related_question_id INTEGER REFERENCES questions(id) ON DELETE SET NULL,
  dedupe_key          TEXT,          -- prevents duplicate scheduled notifications
  read_at             TIMESTAMPTZ,
  emailed_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notifications_dedupe_uq ON notifications (recipient_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notifications_recipient_idx ON notifications (recipient_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (recipient_id) WHERE read_at IS NULL;

CREATE TABLE notification_runs (
  id           BIGSERIAL PRIMARY KEY,
  run_key      TEXT NOT NULL UNIQUE,  -- e.g. "2026-10-03T14" => one processing slot per hour
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  stats        JSONB
);
