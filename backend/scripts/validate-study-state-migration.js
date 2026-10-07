// Read-only preflight for 004_scoped_study_state.sql. Safe to run before
// migration; exits non-zero for data that needs an explicit resolution.
import '../src/config/env.js';
import { getPool, closePool } from '../src/config/db.js';
import { lowestDerivedDay, proposedActiveGroupId } from '../src/services/studyStateMigration.js';

const pool = getPool();
const client = await pool.connect();
try {
  await client.query('BEGIN READ ONLY');
  const counts = await client.query(`
    WITH memberships AS (
      SELECT user_id, count(*)::INTEGER AS n
      FROM group_members GROUP BY user_id
    ), legacy AS (
      SELECT u.id, count(DISTINCT da.assignment_date)::INTEGER AS day
      FROM users u LEFT JOIN daily_assignments da
        ON da.user_id=u.id AND da.assignment_date<=CURRENT_DATE
       AND EXTRACT(DOW FROM da.assignment_date)<>0
      GROUP BY u.id
    )
    SELECT CURRENT_DATE::TEXT AS cutoff_date, count(*)::INTEGER AS total_users,
      count(*) FILTER (WHERE COALESCE(m.n,0)=0)::INTEGER AS users_zero_memberships,
      count(*) FILTER (WHERE m.n=1)::INTEGER AS users_one_membership,
      count(*) FILTER (WHERE m.n>1)::INTEGER AS users_multiple_memberships
    FROM users u LEFT JOIN memberships m ON m.user_id=u.id
  `);

  const activeRows = await client.query(`
    SELECT u.id AS user_id,COALESCE(array_agg(gm.group_id::TEXT ORDER BY gm.joined_at,gm.group_id)
      FILTER (WHERE gm.group_id IS NOT NULL),'{}') AS group_ids
    FROM users u LEFT JOIN group_members gm ON gm.user_id=u.id GROUP BY u.id ORDER BY u.id
  `);
  const active = { rows: activeRows.rows.map((u) => ({ user_id: u.user_id,
    proposed_active_group_id: proposedActiveGroupId(u.group_ids), membership_count: u.group_ids.length })) };
  const solo = await client.query(`
    SELECT u.id AS user_id, NULLIF(count(DISTINCT da.assignment_date),0)::INTEGER AS proposed_current_study_day,
           (count(DISTINCT da.assignment_date)>0) AS initialized
    FROM users u LEFT JOIN daily_assignments da ON da.user_id=u.id
      AND da.assignment_date<=CURRENT_DATE AND EXTRACT(DOW FROM da.assignment_date)<>0
    GROUP BY u.id ORDER BY u.id
  `);
  const groupMemberDays = await client.query(`
    SELECT g.id AS group_id,gm.user_id,
      count(DISTINCT da.assignment_date)::INTEGER AS derived_day
    FROM groups g LEFT JOIN group_members gm ON gm.group_id=g.id
    LEFT JOIN daily_assignments da ON da.user_id=gm.user_id
      AND da.assignment_date<=CURRENT_DATE AND EXTRACT(DOW FROM da.assignment_date)<>0
    GROUP BY g.id,gm.user_id ORDER BY g.id,gm.user_id
  `);
  const groupMap = new Map();
  for (const row of groupMemberDays.rows) {
    const group = groupMap.get(row.group_id) || { group_id: row.group_id, member_days: [] };
    if (row.user_id) group.member_days.push(row.derived_day);
    groupMap.set(row.group_id,group);
  }
  const groups = { rows: [...groupMap.values()].map((g) => ({ group_id:g.group_id,
    member_count:g.member_days.length, proposed_study_day:lowestDerivedDay(g.member_days) })) };
  const emptyGroups = groups.rows.filter((g) => g.member_count === 0);
  const noDayGroups = groups.rows.filter((g) => g.member_count > 0 && !g.proposed_study_day);
  const tiedMappingAmbiguities = await client.query(`
    WITH member_days AS (
      SELECT gm.group_id,gm.user_id,gm.joined_at,
        count(DISTINCT da.assignment_date)::INTEGER AS derived_day
      FROM group_members gm LEFT JOIN daily_assignments da ON da.user_id=gm.user_id
        AND da.assignment_date<=CURRENT_DATE AND EXTRACT(DOW FROM da.assignment_date)<>0
      GROUP BY gm.group_id,gm.user_id,gm.joined_at
    ), lowest AS (
      SELECT group_id,min(derived_day) FILTER (WHERE derived_day>0) AS min_day
      FROM member_days GROUP BY group_id
    ), day_maps AS (
      SELECT md.group_id,md.user_id,
        string_agg((x.study_day||':'||x.position||':'||x.question_id)::TEXT,',' ORDER BY x.study_day,x.position) AS mapping
      FROM member_days md JOIN lowest l ON l.group_id=md.group_id AND l.min_day=md.derived_day
      JOIN LATERAL (
        SELECT ranked.study_day,da.position,da.question_id
        FROM (
          SELECT assignment_date,row_number() OVER (PARTITION BY user_id ORDER BY assignment_date)::INTEGER AS study_day
          FROM (SELECT DISTINCT user_id,assignment_date FROM daily_assignments
                WHERE assignment_date<=CURRENT_DATE AND EXTRACT(DOW FROM assignment_date)<>0) dates
          WHERE user_id=md.user_id
        ) ranked JOIN daily_assignments da ON da.user_id=md.user_id AND da.assignment_date=ranked.assignment_date
        WHERE ranked.study_day<=l.min_day
      ) x ON true
      GROUP BY md.group_id,md.user_id
    ), variants AS (
      SELECT group_id,count(DISTINCT COALESCE(mapping,''))::INTEGER AS mapping_variants
      FROM day_maps GROUP BY group_id
    )
    SELECT group_id,mapping_variants FROM variants WHERE mapping_variants>1 ORDER BY group_id
  `);
  const invalidActive = active.rows.filter((u) => {
    const candidate = u.proposed_active_group_id;
    const belongsToUser = candidate !== null && u.group_ids.includes(candidate);
    return candidate === null
      ? u.membership_count === 1
      : u.membership_count !== 1 || !belongsToUser;
  });
  const ambiguities = [
    ...tiedMappingAmbiguities.rows.map((g) => ({ kind: 'lowest_day_members_have_different_assignments', group_id: g.group_id, mapping_variants: g.mapping_variants })),
    ...invalidActive.map((u) => ({ kind: 'invalid_active_group_candidate', user_id: u.user_id })),
  ];
  const report = {
    cutoff_date: counts.rows[0].cutoff_date,
    users: counts.rows[0],
    proposed_active_group_id: active.rows,
    proposed_solo_states: solo.rows,
    groups_and_proposed_days: groups.rows,
    groups_with_no_members: emptyGroups,
    groups_without_initialized_legacy_study_day: noDayGroups.map((g) => ({
      ...g,
      status: 'group has no initialized legacy study day',
    })),
    users_with_no_legacy_day: solo.rows.filter((u) => !u.initialized).map((u) => u.user_id),
    constraint_violations: invalidActive,
    ambiguous_records: ambiguities,
    ready_to_migrate: ambiguities.length === 0,
  };
  await client.query('ROLLBACK');
  console.log(JSON.stringify(report, null, 2));
  if (!report.ready_to_migrate) process.exitCode = 2;
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`Study-state migration preflight failed safely: ${err.message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await closePool();
}
