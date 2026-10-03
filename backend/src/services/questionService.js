import { query } from '../config/db.js';
import { today } from '../utils/dates.js';
import { forbidden, notFound } from '../utils/errors.js';
import * as model from '../models/questionModel.js';

export const list = (userId, filters) => model.listQuestions(userId, filters, today());

export async function topics() {
  const { rows } = await query('SELECT topic, min(roadmap_order)::int AS roadmap_order, count(*)::int AS total FROM questions GROUP BY topic ORDER BY min(roadmap_order)');
  return rows;
}

export async function get(userId, id) {
  const q = await model.getQuestion(userId, id);
  if (!q) throw notFound('QUESTION_NOT_FOUND', 'Question not found');
  return q;
}

export async function approaches(userId, id) {
  if (!(await model.questionExists(id))) throw notFound('QUESTION_NOT_FOUND', 'Question not found');
  const access = await query(
    'SELECT 1 FROM user_solutions WHERE user_id=$1 AND question_id=$2 AND submitted_at IS NOT NULL', [userId, id]);
  if (!access.rowCount) {
    throw forbidden('SOLUTION_LOCKED', 'Submit your own solution before viewing the official solution');
  }
  const { rows } = await query(
    `SELECT id, position, title, description, algorithm, time_complexity, space_complexity, code, provided_by
     FROM solution_approaches WHERE question_id=$1 ORDER BY position`, [id]);
  return rows.map((r) => ({ ...r, origin: r.provided_by === 'source' ? 'From the source PDF' : 'Written for DSA Squad (not from the PDF)' }));
}
