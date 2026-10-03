import { useState } from 'react';
import { api } from '../services/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { ErrorBox, PageSkeleton, PageTitle, ProgressBar, SourceBadges, StatusBadge, QuestionLink } from '../components/ui.jsx';

export default function Roadmap() {
  const { data, error, loading, reload } = useAsync(() => api.get('/questions'));
  const [open, setOpen] = useState({});
  if (loading) return <PageSkeleton rows={4} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const groups = [];
  for (const q of data.items) {
    let g = groups[groups.length - 1];
    if (!g || g.topic !== q.topic) { g = { topic: q.topic, items: [] }; groups.push(g); }
    g.items.push(q);
  }
  return (
    <div>
      <PageTitle title="Roadmap"><span className="text-sm text-soft">{data.total} questions in {groups.length} topics, in the order you will meet them</span></PageTitle>
      <div className="space-y-3">
        {groups.map((g, i) => {
          const solved = g.items.filter((q) => ['SOLVED', 'REVISED', 'NEEDS_REVISION'].includes(q.status)).length;
          const isOpen = !!open[g.topic];
          return (
            <section key={g.topic} className="card card-interactive !p-0">
              <button className="flex w-full items-center justify-between gap-4 p-4 text-left" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [g.topic]: !isOpen })}>
                <span><span className="mr-2 text-sm text-soft">{i + 1}.</span><span className="font-display text-lg font-semibold">{g.topic}</span></span>
                <span className="flex w-40 shrink-0 items-center gap-3"><span className="w-12 text-right text-sm tabular-nums text-soft">{solved}/{g.items.length}</span><span className="flex-1"><ProgressBar value={solved} total={g.items.length} tone={solved === g.items.length ? 'ok' : 'brand'} label={g.topic} /></span></span>
              </button>
              {isOpen && (
                <ul className="divide-y divide-line border-t border-line">
                  {g.items.map((q) => (
                    <li key={q.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="flex min-w-0 items-center gap-2"><span className="w-6 text-right tabular-nums text-soft">{q.question_order}</span><QuestionLink q={q} /></span>
                      <span className="flex shrink-0 items-center gap-2"><SourceBadges badges={q.badges} /><StatusBadge status={q.status} /></span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
