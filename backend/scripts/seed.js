import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertConfig } from '../src/config/env.js';
import { getPool, closePool } from '../src/config/db.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/seeds');
const slugify = (t) => t.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Idempotent: safe to run repeatedly. Returns counts. */
export async function seed({ quiet = false } = {}) {
  assertConfig();
  const questions = JSON.parse(fs.readFileSync(path.join(dir, 'questions.json'), 'utf8'));
  const approaches = JSON.parse(fs.readFileSync(path.join(dir, 'approaches.json'), 'utf8'));

  // Roadmap order of topics = order of first appearance in the PDF.
  const topicOrder = [];
  for (const q of questions) if (!topicOrder.includes(q.topic)) topicOrder.push(q.topic);
  const perTopic = {};
  const used = new Set();

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const slugToId = {};
    for (const q of questions) {
      let slug = slugify(q.title);
      while (used.has(slug)) slug += '-2';
      used.add(slug);
      perTopic[q.topic] = (perTopic[q.topic] || 0) + 1;
      const { rows } = await client.query(
        `INSERT INTO questions (slug, title, topic, roadmap_order, question_order, in_neetcode, in_striver, source_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title, topic=EXCLUDED.topic, in_neetcode=EXCLUDED.in_neetcode,
           in_striver=EXCLUDED.in_striver, source_note=EXCLUDED.source_note
         RETURNING id`,
        [slug, q.title, q.topic, topicOrder.indexOf(q.topic) + 1, perTopic[q.topic], q.in_neetcode, q.in_striver, q.source_note]
      );
      const id = rows[0].id;
      slugToId[slug] = id;
      for (const [kind, key] of [['leetcode', 'leetcode_url'], ['neetcode', 'neetcode_url'], ['striver', 'striver_url'], ['youtube', 'youtube_url']]) {
        if (q[key]) {
          await client.query(
            `INSERT INTO question_sources (question_id, kind, url) VALUES ($1,$2,$3)
             ON CONFLICT (question_id, kind) DO UPDATE SET url = EXCLUDED.url`, [id, kind, q[key]]);
        }
      }
    }
    let approachCount = 0;
    for (const [slug, list] of Object.entries(approaches)) {
      if (!slugToId[slug]) throw new Error(`approaches.json references unknown question slug "${slug}"`);
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        await client.query(
          `INSERT INTO solution_approaches (question_id, position, title, description, algorithm, time_complexity, space_complexity, code, provided_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'application')
           ON CONFLICT (question_id, position) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description,
             algorithm=EXCLUDED.algorithm, time_complexity=EXCLUDED.time_complexity, space_complexity=EXCLUDED.space_complexity,
             code=EXCLUDED.code, updated_at=now()`,
          [slugToId[slug], i + 1, a.title, a.description, a.algorithm, a.time_complexity, a.space_complexity, a.code]);
        approachCount++;
      }
    }
    await client.query('COMMIT');
    if (!quiet) console.log(`Seeded ${questions.length} questions across ${topicOrder.length} topics, ${approachCount} approaches.`);
    return { questions: questions.length, topics: topicOrder.length, approaches: approachCount };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed().then(() => closePool()).catch((e) => { console.error(e.message); process.exit(1); });
}
