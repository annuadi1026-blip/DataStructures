import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useStudyState } from '../context/StudyStateContext.jsx';
import { Empty, ErrorBox, PageTitle, ProgressBar, Spinner } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export function GroupSetup({ onDone }) {
  const [name, setName] = useState(''); const [code, setCode] = useState(''); const [err, setErr] = useState(null);
  const create = async (e) => { e.preventDefault(); setErr(null); try { const d = await api.post('/groups', { name }); await onDone(d.group.id); } catch (x) { setErr(x); } };
  const join = async (e) => { e.preventDefault(); setErr(null); try { const d = await api.post('/groups/join', { code }); await onDone(d.group.id); } catch (x) { setErr(x); } };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <form onSubmit={create} className="card space-y-3"><h2 className="text-lg font-semibold">Start a squad</h2>
        <div><label className="label" htmlFor="gname">Group name</label><input id="gname" className="input" required minLength={2} maxLength={60} placeholder="DSA Squad" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <button className="btn-primary">Create group</button></form>
      <form onSubmit={join} className="card space-y-3"><h2 className="text-lg font-semibold">Join with an invite code</h2>
        <div><label className="label" htmlFor="gcode">Invite code</label><input id="gcode" className="input font-mono" required value={code} onChange={(e) => setCode(e.target.value)} /></div>
        <button className="btn-ghost">Join group</button></form>
      <div className="md:col-span-2"><ErrorBox error={err} /></div>
    </div>
  );
}

export function GroupPicker({ groups, value, onChange }) {
  if (!groups.length) return null;
  return (<label><span className="sr-only">Active study mode and squad</span><select className="input !w-auto" value={value} onChange={(e) => onChange(e.target.value)}><option value="">Solo mode</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>);
}

export function useGroupSelection() {
  const groups = useAsync(() => api.get('/groups'));
  const { studyState, loading: studyLoading, selectActiveSquad, refreshAll } = useStudyState();
  const list = groups.data?.groups || [];
  const gid = studyState?.active_group?.id || '';
  const setGid = (id) => selectActiveSquad(id || null);
  return { groups: { ...groups, loading: groups.loading || studyLoading }, list, gid,
    setGid, refreshStudyState: refreshAll };
}

const MEMBER_STATUS = {
  HOLIDAY: { label: 'Rest day', cls: 'bg-brand-tint text-brand border-brand/30' },
  DONE: { label: 'Complete', cls: 'bg-ok-tint text-ok border-ok/30' },
  PARTIAL: { label: 'In progress', cls: 'bg-warn-tint text-warn border-warn/30' },
  NONE: { label: 'Not started', cls: 'bg-paper text-soft border-line' },
};

function Member({ m, me, onNudge, note }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{m.display_name}{m.id === me && <span className="ml-1 text-xs text-soft">(you)</span>}</div>
          <div className="text-xs text-soft">{m.total_solved} solved · streak {m.current_streak} (best {m.longest_streak})</div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${MEMBER_STATUS[m.status].cls}`} aria-label={`${MEMBER_STATUS[m.status].label}, ${m.today_completed} of ${m.today_target}`}>{m.today_completed}/{m.today_target} · {MEMBER_STATUS[m.status].label}</span>
          {m.id !== me && m.status !== 'DONE' && m.status !== 'HOLIDAY' && (m.can_be_nudged
            ? <button className="btn-ghost !py-1 text-xs" onClick={() => onNudge(m)}>Nudge {m.display_name.split(' ')[0]}</button>
            : <span className="text-xs text-soft">Nudges off</span>)}
          <button className="text-xs text-brand underline" aria-expanded={open} onClick={() => setOpen(!open)}>Topics</button>
        </div>
      </div>
      {note && <p role="status" className={`mt-2 text-xs ${note.ok ? 'text-ok' : 'text-bad'}`}>{note.text}</p>}
      {open && <ul className="mt-3 grid gap-2 sm:grid-cols-2">{m.topics.filter((t) => t.solved > 0).map((t) => (
        <li key={t.topic}><div className="mb-0.5 flex justify-between text-xs"><span>{t.topic}</span><span className="tabular-nums text-soft">{t.solved}/{t.total}</span></div><ProgressBar value={t.solved} total={t.total} label={t.topic} /></li>
      ))}{m.topics.every((t) => t.solved === 0) && <li className="text-xs text-soft">No solved questions yet.</li>}</ul>}
    </li>
  );
}

export default function Group() {
  const { user } = useAuth();
  const { groups, list, gid, setGid, refreshStudyState } = useGroupSelection();
  const prog = useAsync(() => (gid ? api.get(`/groups/${gid}/progress`) : Promise.resolve(null)), [gid]);
  const [notes, setNotes] = useState({});
  if (groups.loading) return <Spinner />;
  if (groups.error) return <ErrorBox error={groups.error} onRetry={groups.reload} />;
  if (!list.length) return (<div><PageTitle title="Your squad" /><GroupSetup onDone={async () => { await refreshStudyState(); groups.reload(); }} /></div>);
  const nudge = async (m) => {
    try { await api.post(`/users/${m.id}/nudge`); setNotes((n) => ({ ...n, [m.id]: { ok: true, text: `Nudged ${m.display_name}.` } })); }
    catch (e) { setNotes((n) => ({ ...n, [m.id]: { ok: false, text: e.message } })); }
  };
  const p = prog.data;
  return (
    <div>
      <PageTitle title={p ? p.group.name : 'Your squad'}><div className="flex items-center gap-2"><GroupPicker groups={list} value={gid} onChange={setGid} />{gid && <Link to="/group/members" className="btn-ghost">Members</Link>}</div></PageTitle>
      {!gid && list.length > 0 && <p className="mb-4 text-sm text-soft">You are in Solo Mode. Choose a squad above to make it your active study mode and view its progress.</p>}
      <ErrorBox error={prog.error} onRetry={prog.reload} />
      {prog.loading && !p && <Spinner />}
      {p && (
        <>
          <p className="mb-3 text-sm text-soft">{p.target === 0 ? 'Sunday is a rest day. No squad practice or nudges are expected.' : `${p.members_completed} of ${p.members.length} members completed today's target of ${p.target}. Solutions stay private unless a member shares them.`}</p>
          <ul className="card divide-y divide-line !p-0">{p.members.map((m) => <Member key={m.id} m={m} me={user.id} onNudge={nudge} note={notes[m.id]} />)}</ul>
          {p.members.length === 1 && <div className="mt-4"><Empty title="It's just you so far">Share the invite code from the Members page.</Empty></div>}
        </>
      )}
    </div>
  );
}
