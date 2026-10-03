import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../services/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { ErrorBox, ExternalLinks, PageSkeleton, SourceBadges, Spinner, StatusBadge } from '../components/ui.jsx';
import StatusControl from '../components/StatusControl.jsx';
import { fmtDate } from '../utils/format.js';

const Code = ({ children }) => <pre className="overflow-x-auto rounded-lg bg-ink p-3 font-mono text-xs leading-relaxed text-white">{children}</pre>;

function Approaches({ id, unlocked }) {
  // Never call the official-solution endpoint until the server says it is unlocked.
  const { data, error, loading, reload } = useAsync(() => (unlocked ? api.get(`/questions/${id}/approaches`) : Promise.resolve(null)), [id, unlocked]);
  return (
    <section className={`card ${unlocked ? 'solution-reveal' : ''}`} aria-labelledby="ways">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-brand">Reference</p><h2 id="ways" className="text-lg font-semibold">Official solution</h2></div><span className={`rounded-full px-2 py-1 text-xs font-semibold ${unlocked ? 'bg-ok-tint text-ok' : 'bg-paper text-soft'}`}>{unlocked ? 'Unlocked' : 'Locked'}</span></div>
      {!unlocked && <p className="mt-3 text-sm text-soft">Submit your own write-up to unlock the official solution. Reference content is not loaded in your browser before submission.</p>}
      {unlocked && loading && <Spinner label="Loading official solution" />}<ErrorBox error={error} onRetry={reload} />
      {data && data.approaches.length === 0 && <p className="text-sm text-soft">No reference approaches have been written for this question yet. Add yours below, and compare with your squad.</p>}
      <div className="mt-4 space-y-4">
        {data?.approaches.map((a, i) => (
          <article key={a.id} className="rounded-lg border border-line p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-base font-semibold">Approach {i + 1}: {a.title}</h3>
              <span className="font-mono text-xs text-soft">Time {a.time_complexity} · Space {a.space_complexity}</span></div>
            <p className="mt-1 text-sm">{a.description}</p>
            {a.algorithm && <p className="mt-1 text-sm text-soft">{a.algorithm}</p>}
            {a.code && <div className="mt-3"><Code>{a.code}</Code></div>}
            <p className="mt-2 text-xs text-soft">{a.origin}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function MySolution({ id, groups, onSubmitted }) {
  const { data, error, loading, reload } = useAsync(() => api.get(`/questions/${id}/my-solution`), [id]);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const [share, setShare] = useState({ groupId: '', approach: true, code: true, explanation: true, notes: false });
  useEffect(() => { if (data) setForm({ approach: data.solution.approach, code: data.solution.code, timeComplexity: data.solution.time_complexity, spaceComplexity: data.solution.space_complexity, mistakes: data.solution.mistakes, learned: data.solution.learned }); }, [data]);
  useEffect(() => { if (groups.length && !share.groupId) setShare((s) => ({ ...s, groupId: groups[0].id })); }, [groups]);
  if (loading && !form) return <Spinner />;
  if (!form) return <ErrorBox error={error} onRetry={reload} />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null); setMsg('');
    try { await api.put(`/questions/${id}/my-solution`, form); setMsg('Saved'); reload(); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  const submit = async () => {
    setBusy(true); setErr(null); setMsg('');
    try { const r = await api.post(`/questions/${id}/submissions`, form); setMsg('Submitted - official solution unlocked.'); reload(); onSubmitted?.(r.solution); }
    catch (x) { setErr(x); } finally { setBusy(false); }
  };
  const doShare = async () => { setErr(null); try { await api.put(`/questions/${id}/share`, share); setMsg('Shared with group'); reload(); } catch (x) { setErr(x); } };
  const stop = async (gid) => { setErr(null); try { await api.del(`/questions/${id}/share/${gid}`); setMsg('Sharing stopped'); reload(); } catch (x) { setErr(x); } };
  const Field = ({ k, label, rows = 4, mono }) => (
    <div><label className="label" htmlFor={`s-${k}`}>{label}</label><textarea id={`s-${k}`} rows={rows} className={`input ${mono ? 'font-mono text-xs' : ''}`} value={form[k]} onChange={set(k)} /></div>
  );
  return (
    <section className="card" aria-labelledby="mine">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 id="mine" className="text-lg font-semibold">Your solution</h2><p className="mb-3 text-sm text-soft">Save drafts privately, then submit a meaningful write-up to unlock the reference solution.</p></div>{data.solution.submitted_at && <span className="rounded-full bg-ok-tint px-2 py-1 text-xs font-semibold text-ok">Submitted</span>}</div>
      <form onSubmit={save} className="space-y-3">
        <Field k="approach" label="My approach" />
        <Field k="code" label="My code" rows={10} mono />
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="tc">Time complexity</label><input id="tc" className="input font-mono" maxLength={200} value={form.timeComplexity} onChange={set('timeComplexity')} placeholder="O(n)" /></div>
          <div><label className="label" htmlFor="sc">Space complexity</label><input id="sc" className="input font-mono" maxLength={200} value={form.spaceComplexity} onChange={set('spaceComplexity')} placeholder="O(1)" /></div>
        </div>
        <Field k="mistakes" label="Mistakes" rows={3} />
        <Field k="learned" label="What I learned" rows={3} />
        <ErrorBox error={err} />
        <div className="flex flex-wrap items-center gap-3"><button className="btn-ghost" disabled={busy}>{busy ? 'Saving...' : 'Save draft'}</button><button type="button" className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Submitting...' : data.solution.submitted_at ? 'Update submitted solution' : 'Submit to unlock solution'}</button>{msg && <span role="status" className="text-sm text-ok">{msg}</span>}</div>
      </form>
      {data.solution.exists && (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="font-semibold">Share with a group</h3>
          {groups.length === 0 ? <p className="text-sm text-soft">Join or create a group to share your write-up.</p> : (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <select aria-label="Group" className="input !w-auto" value={share.groupId} onChange={(e) => setShare({ ...share, groupId: e.target.value })}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
                {[['approach', 'Approach'], ['code', 'Code'], ['explanation', 'Complexity and learnings'], ['notes', 'Mistakes']].map(([k, l]) => (
                  <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={share[k]} onChange={(e) => setShare({ ...share, [k]: e.target.checked })} />{l}</label>
                ))}
                <button type="button" className="btn-ghost" onClick={doShare}>Share with group</button>
              </div>
              {data.solution.shared_with.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">{data.solution.shared_with.map((s) => (
                  <li key={s.group_id} className="flex items-center gap-3"><span>Shared with <b>{s.group_name}</b></span><button className="text-bad underline" onClick={() => stop(s.group_id)}>Stop sharing</button></li>
                ))}</ul>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function SharedBySquad({ id, groups }) {
  const [gid, setGid] = useState('');
  const { data, error } = useAsync(() => (gid ? api.get(`/groups/${gid}/questions/${id}/shared`) : Promise.resolve(null)), [gid, id]);
  useEffect(() => { if (groups.length && !gid) setGid(groups[0].id); }, [groups]);
  if (!groups.length) return null;
  return (
    <section className="card" aria-labelledby="shared">
      <div className="flex items-center justify-between"><h2 id="shared" className="text-lg font-semibold">Shared by your squad</h2>
        {groups.length > 1 && <select aria-label="Group" className="input !w-auto" value={gid} onChange={(e) => setGid(e.target.value)}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}</div>
      <ErrorBox error={error} />
      {data && data.shared.length === 0 && <p className="mt-2 text-sm text-soft">Nobody has shared a write-up for this question.</p>}
      <div className="mt-3 space-y-4">
        {data?.shared.map((s) => (
          <article key={s.user_id} className="rounded-lg border border-line p-4 text-sm">
            <h3 className="font-semibold">{s.display_name} <span className="font-normal text-soft">@{s.username}</span></h3>
            {s.approach && <p className="mt-2 whitespace-pre-wrap">{s.approach}</p>}
            {s.code && <div className="mt-2"><Code>{s.code}</Code></div>}
            {(s.time_complexity || s.space_complexity) && <p className="mt-2 font-mono text-xs text-soft">Time {s.time_complexity || '-'} · Space {s.space_complexity || '-'}</p>}
            {s.learned && <p className="mt-2"><b>Learned:</b> {s.learned}</p>}
            {s.mistakes && <p className="mt-2"><b>Mistakes:</b> {s.mistakes}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}

export default function QuestionDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useAsync(() => api.get(`/questions/${id}`), [id]);
  const groups = useAsync(() => api.get('/groups'));
  const due = useAsync(() => api.get('/revisions/due'), [id]);
  const [msg, setMsg] = useState(''); const [rerr, setRerr] = useState(null); const [justUnlocked, setJustUnlocked] = useState(false);
  if (loading && !data) return <PageSkeleton rows={4} />;
  if (error) return <div><ErrorBox error={error} /><Link to="/questions" className="mt-3 inline-block text-brand underline">Back to questions</Link></div>;
  const q = data.question;
  const gl = groups.data?.groups || [];
  const isDue = due.data?.items.some((i) => i.question_id === q.id);
  const completeRevision = async () => {
    setRerr(null);
    try { const r = await api.post(`/revisions/${q.id}/complete`); setMsg(r.schedule_finished ? 'Revision complete. That was the last one in the schedule.' : `Revision complete. Next one on ${fmtDate(r.next_revision_at)}.`); reload(); due.reload(); }
    catch (e) { setRerr(e); }
  };
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link to="/questions" className="text-sm text-brand underline">All questions</Link>
      <header className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-sm text-soft">{q.topic}</p><h1 className="text-3xl font-bold">{q.title}</h1></div>
          <div className="flex items-center gap-2"><SourceBadges badges={q.badges} /><StatusBadge status={q.status} /></div>
        </div>
        <div className="mt-3"><ExternalLinks q={q} /></div>
        {q.source_note && <p className="mt-3 text-sm text-soft">Note from the source list: {q.source_note}</p>}
        {q.description ? <p className="mt-3 text-sm">{q.description}</p> : <p className="mt-3 text-sm text-soft">The source list doesn't include a problem statement. Open one of the links above to read it.</p>}
        <div className="mt-4"><StatusControl question={q} onChange={() => { reload(); due.reload(); }} /></div>
      </header>
      <section className="card" aria-labelledby="rev">
        <h2 id="rev" className="text-lg font-semibold">Revision</h2>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-4">
          <div><dt className="text-soft">Solved</dt><dd>{fmtDate(q.solved_at)}</dd></div>
          <div><dt className="text-soft">Last revised</dt><dd>{fmtDate(q.last_revised_at)}</dd></div>
          <div><dt className="text-soft">Next revision</dt><dd>{fmtDate(q.next_revision_at)}</dd></div>
          <div><dt className="text-soft">Times revised</dt><dd>{q.revision_count}</dd></div>
        </dl>
        {q.solved_at && q.next_revision_at && <div className="mt-3"><button className="btn-ghost" onClick={completeRevision}>{isDue ? 'Mark revision complete' : 'Revise now and mark complete'}</button></div>}
        <ErrorBox error={rerr} />{msg && <p role="status" className="mt-2 text-sm text-ok">{msg}</p>}
      </section>
      <MySolution id={q.id} groups={gl} onSubmitted={() => { setJustUnlocked(true); reload(); }} />
      <Approaches id={q.id} unlocked={justUnlocked || q.official_solution_unlocked} />
      <SharedBySquad id={q.id} groups={gl} />
    </div>
  );
}
