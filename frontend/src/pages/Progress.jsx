import { useState } from 'react';
import { api } from '../services/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { ErrorBox, PageSkeleton, PageTitle, ProgressBar, Stat, StatusBadge, QuestionLink } from '../components/ui.jsx';

function Topic({ t }) {
  const [open, setOpen] = useState(false);
  const detail = useAsync(() => (open ? api.get(`/progress/topic/${encodeURIComponent(t.topic)}`) : Promise.resolve(null)), [open]);
  return (
    <li className="py-3">
      <button className="w-full text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{t.topic}</span><span className="tabular-nums text-soft">{t.solved}/{t.total}</span></div>
        <ProgressBar value={t.solved} total={t.total} tone={t.solved === t.total ? 'ok' : 'brand'} label={t.topic} />
      </button>
      {open && detail.data && (
        <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
          {detail.data.questions.map((q) => <li key={q.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-paper"><QuestionLink q={q} /><StatusBadge status={q.status} /></li>)}
        </ul>
      )}
    </li>
  );
}

export default function Progress() {
  const { data, error, loading, reload } = useAsync(() => api.get('/progress'));
  if (loading) return <PageSkeleton rows={3} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div>
      <PageTitle title="My progress" />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Solved" value={`${data.total_solved}/${data.total_questions}`} />
        <Stat label="Remaining" value={data.questions_remaining} />
        <Stat label="Current streak" value={data.current_streak} hint="days" />
        <Stat label="Longest streak" value={data.longest_streak} hint="days" />
      </div>
      <section className="card"><h2 className="text-lg font-semibold">By topic</h2><ul className="divide-y divide-line">{data.topics.map((t) => <Topic key={t.topic} t={t} />)}</ul></section>
    </div>
  );
}
