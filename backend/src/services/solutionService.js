import { query } from '../config/db.js';
import { conflict, notFound } from '../utils/errors.js';
import { questionExists } from '../models/questionModel.js';
import { assertMember } from './groupService.js';

const EMPTY = { approach: '', code: '', time_complexity: '', space_complexity: '', mistakes: '', learned: '', submitted_at: null };

export async function getMine(userId, questionId) {
  if (!(await questionExists(questionId))) throw notFound('QUESTION_NOT_FOUND', 'Question not found');
  const { rows } = await query('SELECT approach, code, time_complexity, space_complexity, mistakes, learned, submitted_at, updated_at FROM user_solutions WHERE user_id=$1 AND question_id=$2', [userId, questionId]);
  const shared = await query(
    `SELECT s.group_id, g.name AS group_name, s.share_approach, s.share_code, s.share_explanation, s.share_notes, s.shared_at
     FROM shared_solutions s JOIN groups g ON g.id = s.group_id WHERE s.user_id=$1 AND s.question_id=$2`, [userId, questionId]);
  return { question_id: questionId, exists: !!rows[0], ...(rows[0] || EMPTY), shared_with: shared.rows };
}

/** Explicit self-reported submission. This app has no code runner, so it never claims correctness. */
export async function submitMine(userId, questionId, b) {
  if (!(await questionExists(questionId))) throw notFound('QUESTION_NOT_FOUND', 'Question not found');
  const meaningful = [b.approach, b.code, b.learned].some((value) => value?.trim());
  if (!meaningful) throw conflict('SUBMISSION_REQUIRED', 'Add an approach, code, or learning before submitting');
  await query(
    `INSERT INTO user_solutions (user_id, question_id, approach, code, time_complexity, space_complexity, mistakes, learned, submitted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
     ON CONFLICT (user_id, question_id) DO UPDATE SET approach=EXCLUDED.approach, code=EXCLUDED.code,
       time_complexity=EXCLUDED.time_complexity, space_complexity=EXCLUDED.space_complexity, mistakes=EXCLUDED.mistakes,
       learned=EXCLUDED.learned, submitted_at=COALESCE(user_solutions.submitted_at, now()), updated_at=now()`,
    [userId, questionId, b.approach, b.code, b.timeComplexity, b.spaceComplexity, b.mistakes, b.learned]);
  return getMine(userId, questionId);
}

export async function saveMine(userId, questionId, b) {
  if (!(await questionExists(questionId))) throw notFound('QUESTION_NOT_FOUND', 'Question not found');
  await query(
    `INSERT INTO user_solutions (user_id, question_id, approach, code, time_complexity, space_complexity, mistakes, learned)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (user_id, question_id) DO UPDATE SET approach=EXCLUDED.approach, code=EXCLUDED.code, time_complexity=EXCLUDED.time_complexity,
       space_complexity=EXCLUDED.space_complexity, mistakes=EXCLUDED.mistakes, learned=EXCLUDED.learned, updated_at=now()`,
    [userId, questionId, b.approach, b.code, b.timeComplexity, b.spaceComplexity, b.mistakes, b.learned]);
  return getMine(userId, questionId);
}

export async function share(userId, questionId, b) {
  await assertMember(userId, b.groupId);
  const sol = await query('SELECT 1 FROM user_solutions WHERE user_id=$1 AND question_id=$2', [userId, questionId]);
  if (!sol.rowCount) throw conflict('SOLUTION_REQUIRED', 'Save your solution before sharing it');
  await query(
    `INSERT INTO shared_solutions (user_id, question_id, group_id, share_approach, share_code, share_explanation, share_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id, question_id, group_id) DO UPDATE SET share_approach=EXCLUDED.share_approach, share_code=EXCLUDED.share_code,
       share_explanation=EXCLUDED.share_explanation, share_notes=EXCLUDED.share_notes, shared_at=now()`,
    [userId, questionId, b.groupId, b.approach, b.code, b.explanation, b.notes]);
  return getMine(userId, questionId);
}

export async function unshare(userId, questionId, groupId) {
  await query('DELETE FROM shared_solutions WHERE user_id=$1 AND question_id=$2 AND group_id=$3', [userId, questionId, groupId]);
  return getMine(userId, questionId);
}

/** What group members chose to share for a question. Private fields are never selected unless their flag is true. */
export async function listShared(viewerId, groupId, questionId) {
  await assertMember(viewerId, groupId);
  const { rows } = await query(
    `SELECT u.id AS user_id, u.display_name, u.username, s.shared_at,
       CASE WHEN s.share_approach THEN us.approach END AS approach,
       CASE WHEN s.share_code THEN us.code END AS code,
       CASE WHEN s.share_explanation THEN us.time_complexity END AS time_complexity,
       CASE WHEN s.share_explanation THEN us.space_complexity END AS space_complexity,
       CASE WHEN s.share_explanation THEN us.learned END AS learned,
       CASE WHEN s.share_notes THEN us.mistakes END AS mistakes
     FROM shared_solutions s
     JOIN user_solutions us ON us.user_id = s.user_id AND us.question_id = s.question_id
     JOIN users u ON u.id = s.user_id
     WHERE s.group_id=$1 AND s.question_id=$2 AND s.user_id <> $3 ORDER BY s.shared_at DESC`, [groupId, questionId, viewerId]);
  return rows;
}
