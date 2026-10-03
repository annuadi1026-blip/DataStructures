-- A personal write-up may be saved as a draft. Only an explicit submission
-- unlocks the application's reference approaches for that user/question.
ALTER TABLE user_solutions
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS user_solutions_submitted_idx
  ON user_solutions (user_id, question_id)
  WHERE submitted_at IS NOT NULL;
