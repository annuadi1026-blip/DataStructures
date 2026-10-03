import { useState } from 'react';
import { api } from '../services/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { Empty, ErrorBox, PageTitle, Spinner, QuestionLink } from '../components/ui.jsx';
import { fmtDate } from '../utils/format.js';

export default function Revisions() {
  const { data, error, loading, reload } = useAsync(() => api.get('/revisions/due'));
  const [err, setErr] = useState(null); const [msg, setMsg] = useState('');
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const done = async (qid) => {
    setErr(null);
    try { const r = await api.post(`/revisions/${qid}/complete`); setMsg(r.schedule_finished ? 'Revision complete. Schedule finished for that question.' : `Revision complete. Next on ${fmtDate(r.next_revision_at)}.`); reload(); }
    catch (e) { setErr(e); }
  };
  return (
    <div>
      <PageTitle title="Revision due today" />
      <ErrorBox error={err} />{msg && <p role="status" className="mb-3 text-sm text-ok">{msg}</p>}
      {data.items.length === 0 ? <Empty title="Nothing to revise today">Solved questions come back here after 1, 3, 7 and 21 days by default.</Empty> : (
        <ul className="card divide-y divide-line !p-0">
          {data.items.map((i) => (
            <li key={i.question_id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div><QuestionLink q={{ id: i.question_id, title: i.title }} /><div className="text-xs text-soft">{i.topic} · revision {i.stage} of {data.total_stages}{i.overdue && ` · due ${fmtDate(i.due_date)}`}</div></div>
              <button className="btn-primary" onClick={() => done(i.question_id)}>Mark revision complete</button>
            </li>
          ))}
        </ul>
      )}
      {data.upcoming.length > 0 && (
        <section className="card mt-6"><h2 className="mb-2 text-lg font-semibold">Coming up</h2>
          <ul className="divide-y divide-line text-sm">{data.upcoming.map((i) => <li key={`${i.question_id}-${i.stage}`} className="flex justify-between py-2"><QuestionLink q={{ id: i.question_id, title: i.title }} /><span className="text-soft">{fmtDate(i.due_date)} · revision {i.stage}</span></li>)}</ul></section>
      )}
    </div>
  );
}
