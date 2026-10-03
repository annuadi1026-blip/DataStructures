import { query } from '../config/db.js';

const BASE = `
  SELECT q.id, q.slug, q.title, q.topic, q.roadmap_order, q.question_order, q.in_neetcode, q.in_striver,
         q.difficulty, q.description, q.source_note,
         COALESCE(p.status, 'NOT_STARTED') AS status, p.solved_at, p.last_revised_at, p.next_revision_at, COALESCE(p.revision_count,0) AS revision_count,
         EXISTS (SELECT 1 FROM user_solutions us WHERE us.user_id = $1 AND us.question_id = q.id AND us.submitted_at IS NOT NULL) AS official_solution_unlocked,
         (SELECT json_object_agg(s.kind, s.url) FROM question_sources s WHERE s.question_id = q.id) AS sources
  FROM questions q
  LEFT JOIN user_question_progress p ON p.question_id = q.id AND p.user_id = $1`;

/** Shape a DB row into the API representation. Source fields come from the PDF; difficulty/description are null unless added later. */
export function shapeQuestion(r) {
  const s = r.sources || {};
  return {
    id: r.id, slug: r.slug, title: r.title, topic: r.topic,
    roadmap_order: r.roadmap_order, question_order: r.question_order,
    source: r.in_neetcode && r.in_striver ? 'BOTH' : r.in_neetcode ? 'NEETCODE' : 'STRIVER',
    badges: [r.in_neetcode && 'N', r.in_striver && 'S'].filter(Boolean),
    leetcode_url: s.leetcode || null, neetcode_url: s.neetcode || null,
    striver_url: s.striver || null, youtube_url: s.youtube || null,
    difficulty: r.difficulty, description: r.description, source_note: r.source_note,
    status: r.status, solved_at: r.solved_at, last_revised_at: r.last_revised_at,
    next_revision_at: r.next_revision_at, revision_count: r.revision_count,
    official_solution_unlocked: r.official_solution_unlocked,
  };
}

export async function listQuestions(userId, f, today) {
  const where = []; const params = [userId];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.q) add(`q.title ILIKE ?`, `%${f.q.replace(/[%_\\]/g, '\\$&')}%`);
  if (f.topic) add(`q.topic = ?`, f.topic);
  if (f.source === 'NEETCODE') where.push('q.in_neetcode');
  if (f.source === 'STRIVER') where.push('q.in_striver');
  if (f.source === 'BOTH') where.push('(q.in_neetcode AND q.in_striver)');
  if (f.status) add(`COALESCE(p.status,'NOT_STARTED') = ?`, f.status);
  if (f.solved === 'true') where.push('p.solved_at IS NOT NULL');
  if (f.solved === 'false') where.push('p.solved_at IS NULL');
  if (f.revisionDue === 'true') add(`EXISTS (SELECT 1 FROM revisions r WHERE r.user_id = $1 AND r.question_id = q.id AND r.completed_at IS NULL AND r.due_date <= ?::date)`, today);
  const sql = `${BASE} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.roadmap_order, q.question_order`;
  const { rows } = await query(sql, params);
  return rows.map(shapeQuestion);
}

export async function getQuestion(userId, id) {
  const { rows } = await query(`${BASE} WHERE q.id = $2`, [userId, id]);
  return rows[0] ? shapeQuestion(rows[0]) : null;
}

export async function questionExists(id, client) {
  const { rowCount } = await (client || { query }).query('SELECT 1 FROM questions WHERE id = $1', [id]);
  return rowCount > 0;
}
