import { useEffect } from 'react';
import { api } from '../services/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, ExternalLinks, PageSkeleton, PageTitle, ProgressBar, SourceBadges, QuestionLink } from '../components/ui.jsx';
import StatusControl from '../components/StatusControl.jsx';
import { fmtDate } from '../utils/format.js';

export default function Today() {
  const { data, error, loading, reload } = useAsync(() => api.get('/daily'));
  useEffect(() => {
    window.addEventListener('study-state:refresh-related', reload);
    return () => window.removeEventListener('study-state:refresh-related', reload);
  }, [reload]);
  if (loading && !data) return <PageSkeleton rows={3} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const d = data;
  return (
    <div>
      <PageTitle title={d.needs_choose_solo_start ? 'Solo setup required' : d.target === 0 ? 'Sunday — Rest day' : `Day ${d.day_number}`}><div className="text-right"><div className="text-sm font-medium">{d.mode === 'SQUAD' ? d.group?.name : 'Solo'}{d.day_number ? ` · Day ${d.day_number}` : ''}{d.paused ? ' · Paused' : ''}</div><div className="text-xs text-soft">{fmtDate(d.date)}</div></div></PageTitle>
      {d.paused && <div role="status" className="card mb-5 border-warn/40 bg-warn-tint/40"><p className="font-medium">Study is paused</p><p className="mt-1 text-sm text-soft">Your study day will not advance while paused. Existing assignments remain available.</p></div>}
      {d.needs_choose_solo_start ? <div className="card mb-5"><p className="text-sm text-soft">Choose a starting day above to initialize Solo study. Daily questions will not be assigned before you choose.</p></div> : d.target === 0 ? <div className="card mb-5"><p className="text-sm text-soft">Sunday is a holiday. No practice is required, and your streak is preserved.</p></div> : d.paused ? <>
        {d.assignments.length === 0 && <Empty title="No assignments available">Your study day is paused; progression will resume when you choose to resume.</Empty>}
      </> : <>
        <div className="card mb-5">
          <div className="mb-2 flex justify-between text-sm"><span>{d.completed_count} of {d.target} done</span>{d.completed_count >= d.target && <span className="font-medium text-ok">Target complete</span>}</div>
          <ProgressBar value={d.completed_count} total={d.target} tone={d.completed_count >= d.target ? 'ok' : 'brand'} label="Today's progress" />
        </div>
        {d.assignments.length === 0 && <Empty title="The roadmap is complete">There are no more unassigned questions.</Empty>}
      </>}
      {d.target > 0 && <ol className="space-y-4">
        {d.assignments.map((a) => (
          <li key={a.id} className={`card card-interactive ${a.completed ? 'border-ok/40 bg-ok-tint/40' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-xs text-soft">Question {a.position} · {a.topic}</div>
                <h2 className="mt-0.5 text-xl font-semibold"><QuestionLink q={a} /></h2>
                {a.source_note && <p className="mt-1 text-xs text-soft">Note from the source list: {a.source_note}</p>}
              </div>
              <SourceBadges badges={a.badges} />
            </div>
            <div className="mt-3"><ExternalLinks q={a} /></div>
            <div className="mt-4"><StatusControl question={a} onChange={reload} /></div>
            <div className="mt-3"><Link to={`/questions/${a.id}`} className="text-sm text-brand underline">Write up how you solved it</Link></div>
          </li>
        ))}
      </ol>}
      {d.pending_from_earlier_days.length > 0 && (
        <section className="card mt-6">
          <h2 className="mb-2 text-lg font-semibold">Still open from earlier days</h2>
          <ul className="divide-y divide-line text-sm">
            {d.pending_from_earlier_days.map((q) => (
              <li key={q.id} className="flex justify-between py-2"><QuestionLink q={q} /><span className="text-soft">{q.topic} · assigned {fmtDate(q.assignment_date)}</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
