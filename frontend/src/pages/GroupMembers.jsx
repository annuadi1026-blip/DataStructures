import { useState } from 'react';
import { api } from '../services/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../context/AuthContext.jsx';
import { ErrorBox, PageTitle, Spinner } from '../components/ui.jsx';
import { GroupPicker, GroupSetup, useGroupSelection } from './Group.jsx';
import { fmtDate } from '../utils/format.js';

export default function GroupMembers() {
  const { user } = useAuth();
  const { groups, list, gid, setGid, refreshStudyState } = useGroupSelection();
  const detail = useAsync(() => (gid ? api.get(`/groups/${gid}`) : Promise.resolve(null)), [gid]);
  const [ident, setIdent] = useState(''); const [err, setErr] = useState(null); const [msg, setMsg] = useState('');
  const [invite, setInvite] = useState(null);
  if (groups.loading) return <Spinner />;
  if (!list.length) return (<div><PageTitle title="Members" /><GroupSetup onDone={async () => { await refreshStudyState(); groups.reload(); }} /></div>);
  const g = detail.data?.group;
  const run = async (fn, ok) => { setErr(null); setMsg(''); try { await fn(); setMsg(ok); detail.reload(); groups.reload(); } catch (e) { setErr(e); } };
  const owner = g?.my_role === 'owner';
  const code = invite?.code || g?.invite?.code;
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title={g ? `${g.name} members` : 'Members'}><GroupPicker groups={list} value={gid} onChange={setGid} /></PageTitle>
      <ErrorBox error={err || detail.error} />{msg && <p role="status" className="mb-3 text-sm text-ok">{msg}</p>}
      {!gid && <p className="mb-4 text-sm text-soft">You are in Solo Mode. Choose a squad above to make it active and view its members.</p>}
      {g && (
        <>
          <ul className="card mb-5 divide-y divide-line !p-0">
            {g.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 p-4">
                <div><span className="font-medium">{m.display_name}</span> <span className="text-sm text-soft">@{m.username}</span>{m.role === 'owner' && <span className="ml-2 rounded bg-brand-tint px-1.5 py-0.5 text-xs text-brand">Owner</span>}
                  <div className="text-xs text-soft">Joined {fmtDate(m.joined_at)}</div></div>
                {m.id === user.id
                  ? <button className="btn-ghost !py-1 text-xs" onClick={() => confirm('Leave this group?') && run(async () => { await api.del(`/groups/${gid}/members/${m.id}`); await refreshStudyState(); }, 'You left the group')}>Leave</button>
                  : owner && <button className="btn-ghost !py-1 text-xs text-bad" onClick={() => confirm(`Remove ${m.display_name}?`) && run(() => api.del(`/groups/${gid}/members/${m.id}`), `${m.display_name} removed`)}>Remove</button>}
              </li>
            ))}
          </ul>
          <div className="grid gap-4 md:grid-cols-2">
            <section className="card"><h2 className="text-lg font-semibold">Invite friends</h2>
              <p className="mb-2 text-sm text-soft">Send them this code. They enter it under Squad &gt; Join.</p>
              {code ? <div className="mb-3 select-all rounded-lg bg-paper px-3 py-2 font-mono text-lg tracking-widest" aria-label="Invite code">{code}</div> : <p className="mb-3 text-sm text-soft">No active code.</p>}
              <button className="btn-ghost" onClick={() => run(async () => setInvite((await api.post(`/groups/${gid}/invites`, {})).invite), 'New invite code created')}>New invite code</button></section>
            {owner && (
              <form className="card" onSubmit={(e) => { e.preventDefault(); run(async () => { await api.post(`/groups/${gid}/members`, { identifier: ident }); setIdent(''); }, 'Member added'); }}>
                <h2 className="text-lg font-semibold">Add by username or email</h2>
                <label className="label mt-2" htmlFor="ident">Username or email</label><input id="ident" className="input" required value={ident} onChange={(e) => setIdent(e.target.value)} />
                <button className="btn-primary mt-3">Add member</button></form>
            )}
          </div>
        </>
      )}
      <details className="mt-6"><summary className="cursor-pointer text-sm text-brand">Create or join another group</summary><div className="mt-3"><GroupSetup onDone={async () => { await refreshStudyState(); groups.reload(); }} /></div></details>
    </div>
  );
}
