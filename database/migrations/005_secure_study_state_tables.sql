-- Migration 002 predates the study-state tables created by migration 004.
-- Keep them private from Supabase's Data API roles, including projects that
-- automatically grant privileges on newly created public tables.
ALTER TABLE solo_study_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_study_day_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE solo_study_day_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_day_daily_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_pause_days ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON solo_study_states, group_study_day_questions, solo_study_day_questions, study_day_daily_assignments, study_pause_days FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON solo_study_states, group_study_day_questions, solo_study_day_questions, study_day_daily_assignments, study_pause_days FROM authenticated';
  END IF;
END $$;
