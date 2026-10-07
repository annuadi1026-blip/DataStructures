import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { addDays, dailyTarget, isSunday, today } from '../utils/dates.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { shapeQuestion } from '../models/questionModel.js';

const scopeInfo = (mode, id) => mode === 'SQUAD'
  ? { mode, id, table: 'group_study_day_questions', key: 'group_id', stateTable: 'groups' }
  : { mode, id, table: 'solo_study_day_questions', key: 'user_id', stateTable: 'solo_study_states' };

export function firstProgressionAnchor(date = today()) {
  // Starting on Sunday means the selected day begins on Monday; Sunday itself
  // is not counted as an active study day.
  return isSunday(date) ? addDays(date, 1) : date;
}

function previousPracticeDate(date) {
  let d = addDays(date, -1);
  while (isSunday(d)) d = addDays(d, -1);
  return d;
}

function initialQuestionOffset(day, activeDate) {
  let cursor = activeDate;
  if (isSunday(cursor)) cursor = addDays(cursor, 1);
  let offset = 0;
  for (let d = 1; d < day; d++) {
    cursor = previousPracticeDate(cursor);
    offset += dailyTarget(cursor);
  }
  return offset;
}

export function maxSupportedStartingDay(questionCount, activeDate = today()) {
  if (questionCount <= 0) return 0;
  let cursor = isSunday(activeDate) ? addDays(activeDate, 1) : activeDate;
  let offset = 0;
  let day = 1;
  while (offset < questionCount) {
    day++;
    cursor = previousPracticeDate(cursor);
    offset += dailyTarget(cursor);
  }
  return day - 1;
}

async function addScopeQuestions(c, scope, day, target, activeDate) {
  if (target <= 0) return;
  const { rows: existing } = await c.query(
    `SELECT position, question_id FROM ${scope.table} WHERE ${scope.key}=$1 AND study_day=$2 ORDER BY position`,
    [scope.id, day]);
  const missingPositions = Array.from({ length: target }, (_, i) => i + 1)
    .filter((position) => !existing.some((row) => row.position === position));
  if (!missingPositions.length) return;

  const prior = await c.query(
    `SELECT q.roadmap_order,q.question_order
     FROM ${scope.table} s JOIN questions q ON q.id=s.question_id
     WHERE s.${scope.key}=$1 ORDER BY s.study_day DESC,s.position DESC LIMIT 1`, [scope.id]);
  const unsolved = scope.mode === 'SOLO'
    ? 'AND NOT EXISTS (SELECT 1 FROM user_question_progress p WHERE p.user_id=$3 AND p.question_id=q.id AND p.solved_at IS NOT NULL)'
    : '';
  let picks;
  if (prior.rows[0]) {
    picks = scope.mode === 'SOLO'
      ? await c.query(
        `SELECT q.id FROM questions q WHERE (q.roadmap_order,q.question_order)>($1,$2) ${unsolved}
         ORDER BY q.roadmap_order,q.question_order LIMIT $4`,
        [prior.rows[0].roadmap_order,prior.rows[0].question_order,scope.id,missingPositions.length])
      : await c.query(
        `SELECT q.id FROM questions q WHERE (q.roadmap_order,q.question_order)>($1,$2)
         ORDER BY q.roadmap_order,q.question_order LIMIT $3`,
        [prior.rows[0].roadmap_order,prior.rows[0].question_order,missingPositions.length]);
  } else {
    picks = await c.query(
      `SELECT q.id FROM questions q WHERE true ${unsolved}
       ORDER BY q.roadmap_order,q.question_order OFFSET $1 LIMIT $2`,
      scope.mode === 'SOLO'
        ? [initialQuestionOffset(day, activeDate),missingPositions.length,scope.id]
        : [initialQuestionOffset(day, activeDate),missingPositions.length]);
  }
  for (let i = 0; i < picks.rows.length; i++) {
    await c.query(
      `INSERT INTO ${scope.table} (${scope.key},study_day,position,question_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [scope.id, day, missingPositions[i], picks.rows[i].id]);
  }
}

async function ensureCurrentScopeMap(c, scope, day, activeDate) {
  if (dailyTarget(activeDate) === 0) return;
  const { rows } = await c.query(
    `SELECT position,question_id FROM ${scope.table} WHERE ${scope.key}=$1 AND study_day=$2 ORDER BY position`,
    [scope.id, day]);
  if (rows.length < dailyTarget(activeDate)) await addScopeQuestions(c, scope, day, dailyTarget(activeDate), activeDate);
}

async function recordPauseDate(c, userId, scope, date) {
  if (scope.mode === 'SQUAD') {
    await c.query(
      `INSERT INTO study_pause_days (user_id,pause_date,scope_type,group_id)
       SELECT user_id,$2,'SQUAD',$1 FROM group_members WHERE group_id=$1 ON CONFLICT DO NOTHING`, [scope.id, date]);
  } else {
    await c.query(
      `INSERT INTO study_pause_days (user_id,pause_date,scope_type,group_id) VALUES ($1,$2,'SOLO',NULL) ON CONFLICT DO NOTHING`,
      [userId, date]);
  }
}

async function recordPausePeriod(c, userId, scope, pauseStartedAt, date) {
  if (!pauseStartedAt) return;
  if (scope.mode === 'SQUAD') {
    await c.query(
      `INSERT INTO study_pause_days (user_id,pause_date,scope_type,group_id)
       SELECT gm.user_id,days.pause_date::date,'SQUAD',$1
       FROM group_members gm CROSS JOIN LATERAL generate_series(
         (($3::timestamptz AT TIME ZONE $4)::date),$2::date,interval '1 day') AS days(pause_date)
       ON CONFLICT DO NOTHING`, [scope.id,date,pauseStartedAt,env.APP_TIMEZONE]);
  } else {
    await c.query(
      `INSERT INTO study_pause_days (user_id,pause_date,scope_type,group_id)
       SELECT $1,days.pause_date::date,'SOLO',NULL FROM generate_series(
         (($3::timestamptz AT TIME ZONE $4)::date),$2::date,interval '1 day') AS days(pause_date)
       ON CONFLICT DO NOTHING`, [userId,date,pauseStartedAt,env.APP_TIMEZONE]);
  }
}

async function advanceScope(c, scope, row, date, userId) {
  if (!row.study_initialized) return { ...row, current_study_day: null };
  if (row.study_paused) {
    await recordPauseDate(c, userId, scope, date);
    await ensureCurrentScopeMap(c, scope, row.current_study_day, date);
    return row;
  }

  let day = row.current_study_day;
  let cursor = row.last_advanced_on;
  if (cursor && date > cursor) {
    for (let d = addDays(cursor, 1); d <= date; d = addDays(d, 1)) {
      const target = dailyTarget(d);
      if (!target) continue;
      day += 1;
      await addScopeQuestions(c, scope, day, target, d);
    }
    const updatedAtColumn = scope.stateTable === 'groups' ? 'study_state_updated_at' : 'updated_at';
    await c.query(
      `UPDATE ${scope.stateTable}
       SET current_study_day=$2,last_advanced_on=$3,${updatedAtColumn}=now()
       WHERE ${scope.stateTable === 'groups' ? 'id' : 'user_id'}=$1`, [scope.id, day, date]);
  }
  await ensureCurrentScopeMap(c, scope, day, date);
  return { ...row, current_study_day: day, last_advanced_on: cursor && date > cursor ? date : cursor };
}

async function currentScopeInTransaction(c, userId, date) {
  const user = await c.query(
    `SELECT u.active_group_id,EXISTS (
       SELECT 1 FROM group_members gm WHERE gm.user_id=u.id AND gm.group_id=u.active_group_id
     ) AS active_group_membership
     FROM users u WHERE u.id=$1 FOR UPDATE`, [userId]);
  if (!user.rows[0]) throw notFound('USER_NOT_FOUND', 'User not found');
  const groupId = user.rows[0].active_group_id;
  const invalidActiveGroup = !!groupId && !user.rows[0].active_group_membership;
  if (groupId && !invalidActiveGroup) {
    const scope = scopeInfo('SQUAD', groupId);
    const state = await c.query(
      `SELECT id,name,current_study_day,study_initialized,study_paused,last_advanced_on,pause_started_at,resumed_at
       FROM groups WHERE id=$1 FOR UPDATE`, [groupId]);
    if (!state.rows[0]) return currentSoloScopeInTransaction(c, userId, date, true);
    const advanced = await advanceScope(c, scope, state.rows[0], date, userId);
    return { scope, row: advanced, group: { id: advanced.id, name: advanced.name }, invalidActiveGroup: false };
  }
  return currentSoloScopeInTransaction(c, userId, date, invalidActiveGroup);
}

async function currentSoloScopeInTransaction(c, userId, date, invalidActiveGroup = false) {
  const scope = scopeInfo('SOLO', userId);
  const state = await c.query(
    `SELECT user_id,current_study_day,study_initialized,study_paused,last_advanced_on,pause_started_at,resumed_at
     FROM solo_study_states WHERE user_id=$1 FOR UPDATE`, [userId]);
  if (!state.rows[0]) {
    const created = await c.query('INSERT INTO solo_study_states (user_id) VALUES ($1) RETURNING *', [userId]);
    return { scope, row: created.rows[0], group: null, invalidActiveGroup };
  }
  const advanced = await advanceScope(c, scope, state.rows[0], date, userId);
  return { scope, row: advanced, group: null, invalidActiveGroup };
}

export async function getDailyStudyData(userId, date = today()) {
  return withTransaction(async (c) => {
    const active = await currentScopeInTransaction(c, userId, date);
    const initialized = !!active.row.study_initialized;
    if (!initialized || dailyTarget(date) === 0) {
      const needsChooseSoloStart = active.scope.mode === 'SOLO' && !initialized;
      return { date, mode: active.scope.mode, group: active.group, study_day: active.row.current_study_day,
        day_number: active.row.current_study_day, initialized, paused: !!active.row.study_paused,
        needs_choose_solo_start: needsChooseSoloStart,
        active_group_invalid: active.invalidActiveGroup,
        target: 0,
        completed_count: 0, assignments: [], pending_from_earlier_days: [] };
    }

    await c.query(
      `INSERT INTO study_day_daily_assignments
         (user_id,scope_type,scope_id,assignment_date,study_day,position,question_id,completed,completed_at)
       SELECT $1,$2,$3,$4,$5,m.position,m.question_id,(p.solved_at IS NOT NULL),p.solved_at
       FROM ${active.scope.table} m LEFT JOIN user_question_progress p
         ON p.user_id=$1 AND p.question_id=m.question_id
       WHERE m.${active.scope.key}=$3 AND m.study_day=$5 AND m.position<=$6
       ON CONFLICT (user_id,assignment_date,scope_type,scope_id,position) DO NOTHING`,
      [userId, active.scope.mode, active.scope.id, date, active.row.current_study_day, dailyTarget(date)]);
    const result = await c.query(
      `SELECT a.position,a.completed,a.completed_at,a.assignment_date,
              q.id,q.slug,q.title,q.topic,q.roadmap_order,q.question_order,q.in_neetcode,q.in_striver,
              q.difficulty,q.description,q.source_note,
              COALESCE(p.status,'NOT_STARTED') AS status,p.solved_at,p.last_revised_at,p.next_revision_at,
              COALESCE(p.revision_count,0) AS revision_count,
              (SELECT json_object_agg(s.kind,s.url) FROM question_sources s WHERE s.question_id=q.id) AS sources
       FROM study_day_daily_assignments a JOIN questions q ON q.id=a.question_id
       LEFT JOIN user_question_progress p ON p.user_id=a.user_id AND p.question_id=a.question_id
       WHERE a.user_id=$1 AND a.scope_type=$2 AND a.scope_id=$3 AND a.assignment_date=$4
       ORDER BY a.position`, [userId, active.scope.mode, active.scope.id, date]);
    const assignments = result.rows.map((r) => ({ ...shapeQuestion(r), position: r.position,
      completed: r.completed || !!r.solved_at, completed_at: r.completed_at || r.solved_at }));
    const pending = await c.query(
      `SELECT q.id,q.title,q.topic,prior.assignment_date FROM (
         SELECT assignment_date,position,question_id FROM daily_assignments
         WHERE user_id=$1 AND assignment_date<$2 AND NOT completed
           AND EXTRACT(DOW FROM assignment_date)<>0
         UNION
         SELECT assignment_date,position,question_id FROM study_day_daily_assignments
         WHERE user_id=$1 AND scope_type=$3 AND scope_id=$4 AND assignment_date<$2 AND NOT completed
           AND EXTRACT(DOW FROM assignment_date)<>0
       ) prior JOIN questions q ON q.id=prior.question_id
       LEFT JOIN user_question_progress p ON p.user_id=$1 AND p.question_id=prior.question_id
       WHERE p.solved_at IS NULL ORDER BY prior.assignment_date,prior.position`,
      [userId, date, active.scope.mode, active.scope.id]);
    return { date, mode: active.scope.mode, group: active.group, study_day: active.row.current_study_day,
      day_number: active.row.current_study_day, initialized: true, paused: !!active.row.study_paused,
      needs_choose_solo_start: false,
      active_group_invalid: active.invalidActiveGroup,
      target: assignments.length, completed_count: assignments.filter((a) => a.completed).length,
      assignments, pending_from_earlier_days: pending.rows };
  });
}

export async function getStudyState(userId, date = today()) {
  await withTransaction(async (c) => currentScopeInTransaction(c, userId, date));
  return readStudyContext(userId);
}

export async function getActiveStudyStatus(userId) {
  const { rows } = await query(
    `SELECT CASE WHEN g.id IS NULL THEN 'SOLO' ELSE 'SQUAD' END AS mode,
            CASE WHEN g.id IS NULL THEN COALESCE(s.study_initialized,false)
                 ELSE COALESCE(g.study_initialized,false) END AS initialized
     FROM users u
     LEFT JOIN group_members gm ON gm.user_id=u.id AND gm.group_id=u.active_group_id
     LEFT JOIN groups g ON g.id=gm.group_id
     LEFT JOIN solo_study_states s ON s.user_id=u.id
     WHERE u.id=$1`, [userId]);
  return rows[0] || { mode: 'SOLO', initialized: false };
}

async function readStudyContext(userId) {
  const { rows: choices } = await query(
    `WITH selected AS (SELECT active_group_id FROM users WHERE id=$1)
     SELECT selected.active_group_id,g.id,g.name,gm.role AS my_role,
            g.current_study_day,g.study_initialized,g.study_paused
     FROM selected
     LEFT JOIN group_members gm ON gm.user_id=$1
     LEFT JOIN groups g ON g.id=gm.group_id
     ORDER BY gm.joined_at,g.id`, [userId]);
  const solo = await query(
    `SELECT current_study_day,study_initialized,study_paused
     FROM solo_study_states WHERE user_id=$1`, [userId]);
  const activeGroupId = choices[0]?.active_group_id || null;
  const availableGroups = choices.filter((group) => group.id).map((group) => ({
    id: group.id, name: group.name, my_role: group.my_role,
    study_day: group.current_study_day, initialized: !!group.study_initialized, paused: !!group.study_paused,
  }));
  const selected = availableGroups.find((group) => group.id === activeGroupId) || null;
  const invalidActiveGroup = !!activeGroupId && !selected;
  const mode = selected ? 'SQUAD' : 'SOLO';
  const soloState = solo.rows[0] ? {
    study_day: solo.rows[0].current_study_day,
    initialized: !!solo.rows[0].study_initialized,
    paused: !!solo.rows[0].study_paused,
  } : { study_day: null, initialized: false, paused: false };
  const study = mode === 'SQUAD' ? selected : soloState;
  return {
    mode,
    active_group: selected,
    active_group_invalid: invalidActiveGroup,
    study_day: study.study_day,
    paused: study.paused,
    study: { study_day: study.study_day, initialized: !!study.initialized, paused: !!study.paused },
    needs_choose_solo_start: mode === 'SOLO' && !soloState.initialized,
    needs_choose_active_squad: mode === 'SOLO' && (availableGroups.length > 0 || invalidActiveGroup),
    available_groups: availableGroups,
    solo: soloState,
  };
}

export async function selectActiveGroup(userId, groupId) {
  await withTransaction(async (c) => {
    const user = await c.query('SELECT active_group_id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    if (!user.rows[0]) throw notFound('USER_NOT_FOUND', 'User not found');
    if (groupId !== null) {
      const membership = await c.query('SELECT 1 FROM group_members WHERE user_id=$1 AND group_id=$2', [userId, groupId]);
      if (!membership.rowCount) throw forbidden('NOT_A_GROUP_MEMBER', 'You can only select a squad you belong to');
    }
    if (user.rows[0].active_group_id !== groupId)
      await c.query('UPDATE users SET active_group_id=$2 WHERE id=$1', [userId, groupId]);
  });
  return readStudyContext(userId);
}

export async function chooseSoloStartingDay(userId, startingDay, date = today()) {
  if (!Number.isInteger(startingDay) || startingDay < 1) {
    throw badRequest('INVALID_STARTING_DAY', 'Starting day must be a positive whole number');
  }
  return withTransaction(async (c) => {
    const user = await c.query('SELECT active_group_id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    if (!user.rows[0]) throw notFound('USER_NOT_FOUND', 'User not found');
    if (user.rows[0].active_group_id) throw conflict('SQUAD_MODE_ACTIVE', 'Switch to Solo Mode before choosing a solo starting day');
    const state = await c.query('SELECT * FROM solo_study_states WHERE user_id=$1 FOR UPDATE', [userId]);
    if (state.rows[0]?.study_initialized) throw conflict('STUDY_STATE_ALREADY_INITIALIZED', 'Your solo starting day has already been chosen');
    const anchor = firstProgressionAnchor(date);
    const available = await c.query(
      `SELECT count(*)::INTEGER AS n FROM questions q
       WHERE NOT EXISTS (SELECT 1 FROM user_question_progress p
         WHERE p.user_id=$1 AND p.question_id=q.id AND p.solved_at IS NOT NULL)`, [userId]);
    if (available.rows[0].n === 0) {
      throw badRequest('INVALID_STARTING_DAY', 'No remaining questions are available for a new starting day');
    }
    const maxDay = maxSupportedStartingDay(available.rows[0].n, anchor);
    if (startingDay > maxDay) {
      throw badRequest('INVALID_STARTING_DAY', `Starting day must be between 1 and ${maxDay} for your remaining questions`);
    }
    const updated = await c.query(
      `INSERT INTO solo_study_states (user_id,current_study_day,study_initialized,study_paused,last_advanced_on,updated_at)
       VALUES ($1,$2,true,false,$3,now())
       ON CONFLICT (user_id) DO UPDATE SET current_study_day=EXCLUDED.current_study_day,
         study_initialized=true,study_paused=false,last_advanced_on=EXCLUDED.last_advanced_on,
         pause_started_at=NULL,resumed_at=NULL,updated_at=now()
       RETURNING *`, [userId, startingDay, anchor]);
    if (dailyTarget(date) > 0) {
      const scope = scopeInfo('SOLO', userId);
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`study:SOLO:${userId}`]);
      await addScopeQuestions(c, scope, startingDay, dailyTarget(date), date);
    }
    return { mode: 'SOLO', study_day: updated.rows[0].current_study_day, initialized: true, paused: false };
  });
}

export async function setStudyPaused(userId, paused, date = today()) {
  return withTransaction(async (c) => {
    const user = await c.query('SELECT active_group_id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    if (!user.rows[0]) throw notFound('USER_NOT_FOUND', 'User not found');
    if (user.rows[0].active_group_id) {
      const role = await c.query(
        'SELECT role FROM group_members WHERE user_id=$1 AND group_id=$2 FOR SHARE',
        [userId,user.rows[0].active_group_id]);
      if (role.rows[0] && role.rows[0].role !== 'owner')
        throw forbidden('NOT_GROUP_OWNER', 'Only the squad admin can pause or resume its study day');
    }
    const active = await currentScopeInTransaction(c, userId, date);
    if (!active.row.study_initialized) throw conflict('STARTING_DAY_REQUIRED', 'Choose a starting day before pausing study');
    if (paused === !!active.row.study_paused) {
      if (paused) await recordPauseDate(c, userId, active.scope, date);
      return { mode: active.scope.mode, study_day: active.row.current_study_day, paused: !!active.row.study_paused };
    }
    if (paused) {
      const updatedAtColumn = active.scope.stateTable === 'groups' ? 'study_state_updated_at' : 'updated_at';
      await c.query(
        `UPDATE ${active.scope.stateTable} SET study_paused=true,pause_started_at=now(),${updatedAtColumn}=now()
         WHERE ${active.scope.stateTable === 'groups' ? 'id' : 'user_id'}=$1`, [active.scope.id]);
      await recordPauseDate(c, userId, active.scope, date);
    } else {
      await recordPausePeriod(c,userId,active.scope,active.row.pause_started_at,date);
      const updatedAtColumn = active.scope.stateTable === 'groups' ? 'study_state_updated_at' : 'updated_at';
      await c.query(
        `UPDATE ${active.scope.stateTable}
         SET study_paused=false,last_advanced_on=$2,pause_started_at=NULL,resumed_at=now(),${updatedAtColumn}=now()
         WHERE ${active.scope.stateTable === 'groups' ? 'id' : 'user_id'}=$1`, [active.scope.id, date]);
    }
    return { mode: active.scope.mode, study_day: active.row.current_study_day, paused };
  });
}

export async function listPauseDates(userIds) {
  const { rows } = await query('SELECT user_id,pause_date FROM study_pause_days WHERE user_id=ANY($1::uuid[])', [userIds]);
  const map = new Map(userIds.map((id) => [id, []]));
  for (const r of rows) map.get(r.user_id)?.push(r.pause_date);
  return map;
}

export async function advanceGroupStudyState(groupId, actorUserId, date = today()) {
  return withTransaction(async (c) => {
    const membership = await c.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [groupId,actorUserId]);
    if (!membership.rowCount) throw forbidden('NOT_A_GROUP_MEMBER', 'You are not a member of this squad');
    const row = await c.query(
      `SELECT id,name,current_study_day,study_initialized,study_paused,last_advanced_on,pause_started_at,resumed_at
       FROM groups WHERE id=$1 FOR UPDATE`, [groupId]);
    if (!row.rows[0]) throw notFound('GROUP_NOT_FOUND', 'Squad not found');
    const scope = scopeInfo('SQUAD', groupId);
    const state = await advanceScope(c,scope,row.rows[0],date,actorUserId);
    return { study_day: state.current_study_day, initialized: !!state.study_initialized, paused: !!state.study_paused };
  });
}

export async function dailyAssignmentCounts(userIds, date, forcedScope = null) {
  const map = new Map(userIds.map((id) => [id, { assigned: 0, completed: 0 }]));
  if (!userIds.length) return map;
  if (forcedScope) {
    if (forcedScope.mode === 'SQUAD') {
      const target = dailyTarget(date);
      if (target === 0) return map;
      const { rows } = await query(
        `WITH expected AS (
           SELECT m.position,m.question_id
           FROM groups g JOIN group_study_day_questions m
             ON m.group_id=g.id AND m.study_day=g.current_study_day AND m.position<=$4
           WHERE g.id=$3 AND g.study_initialized
         ), members AS (SELECT unnest($1::uuid[]) AS user_id)
         SELECT members.user_id,count(expected.position)::INTEGER AS assigned,
           count(*) FILTER (WHERE COALESCE(d.completed,false) OR p.solved_at IS NOT NULL)::INTEGER AS completed
         FROM members
         LEFT JOIN expected ON true
         LEFT JOIN study_day_daily_assignments d ON d.user_id=members.user_id
           AND d.scope_type='SQUAD' AND d.scope_id=$3 AND d.assignment_date=$2
           AND d.position=expected.position
         LEFT JOIN user_question_progress p ON p.user_id=members.user_id AND p.question_id=expected.question_id
         GROUP BY members.user_id`, [userIds,date,forcedScope.id,target]);
      for (const r of rows) map.set(r.user_id,{assigned:r.assigned,completed:r.completed});
      return map;
    }
    const { rows } = await query(
      `SELECT user_id,count(position)::INTEGER AS assigned,count(*) FILTER (WHERE completed)::INTEGER AS completed
       FROM study_day_daily_assignments WHERE user_id=ANY($1::uuid[]) AND assignment_date=$2
         AND scope_type=$3 AND scope_id=$4 GROUP BY user_id`, [userIds,date,forcedScope.mode,forcedScope.id]);
    for (const r of rows) map.set(r.user_id,{assigned:r.assigned,completed:r.completed});
    return map;
  }
  const { rows } = await query(
    `WITH active AS (
       SELECT u.id AS user_id,CASE WHEN u.active_group_id IS NULL THEN 'SOLO' ELSE 'SQUAD' END AS scope_type,
         COALESCE(u.active_group_id,u.id) AS scope_id
       FROM users u WHERE u.id=ANY($1::uuid[])
     ), new_counts AS (
       SELECT a.user_id,count(d.position)::INTEGER AS assigned,count(*) FILTER (WHERE d.completed)::INTEGER AS completed
       FROM active a LEFT JOIN study_day_daily_assignments d ON d.user_id=a.user_id AND d.assignment_date=$2
         AND d.scope_type=a.scope_type AND d.scope_id=a.scope_id GROUP BY a.user_id
     ), legacy_counts AS (
       SELECT user_id,count(*)::INTEGER AS assigned,count(*) FILTER (WHERE completed)::INTEGER AS completed
       FROM daily_assignments WHERE user_id=ANY($1::uuid[]) AND assignment_date=$2 GROUP BY user_id
     )
     SELECT n.user_id,
       CASE WHEN n.assigned>0 THEN n.assigned ELSE COALESCE(l.assigned,0) END::INTEGER AS assigned,
       CASE WHEN n.assigned>0 THEN n.completed ELSE COALESCE(l.completed,0) END::INTEGER AS completed
     FROM new_counts n LEFT JOIN legacy_counts l ON l.user_id=n.user_id`, [userIds,date]);
  for (const r of rows) map.set(r.user_id,{assigned:r.assigned,completed:r.completed});
  return map;
}

export async function dailyCompletionCounts(userIds,date,forcedScope=null) {
  const counts = await dailyAssignmentCounts(userIds,date,forcedScope);
  return new Map([...counts].map(([id,value]) => [id,value.completed]));
}
