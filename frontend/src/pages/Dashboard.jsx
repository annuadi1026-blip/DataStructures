import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../context/AuthContext.jsx';
import { ErrorBox, PageSkeleton, PageTitle, ProgressBar, QuestionLink, Stat, StatusBadge } from '../components/ui.jsx';
import { Stagger } from '../components/motion.jsx';
import { pct } from '../utils/format.js';

export function TopicBars({ topics }) {
  return (
    <ul className="space-y-3">
      {topics.map((t) => (
        <li key={t.topic}>
          <div className="mb-1 flex justify-between text-sm"><span>{t.topic}</span><span className="tabular-nums text-soft">{t.solved}/{t.total}</span></div>
          <ProgressBar value={t.solved} total={t.total} tone={t.solved === t.total ? 'ok' : 'brand'} label={t.topic} />
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.get('/progress'));
  const daily = useAsync(() => api.get('/daily'));
  if (loading) return <PageSkeleton rows={3} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const t = data.today;
  return (
    <div>
      <PageTitle title={`Welcome back, ${user.display_name}`}><Link to="/today" className="btn-primary">Open today's practice</Link></PageTitle>
      <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]">
        <div className="card" aria-label="Today's progress">
          {t.target === 0 ? <><div className="eyebrow mb-1">Sunday</div><div className="font-display text-2xl font-bold">Rest day</div><p className="mt-3 text-sm text-soft">No practice is required today. Your streak is preserved.</p></> : <>
            <div className="flex items-end justify-between">
              <div><div className="eyebrow mb-1">Today's practice</div><div className="font-display text-3xl font-bold tabular-nums">{t.completed} <span className="text-soft">/ {t.target}</span></div></div>
              <div className="font-display text-2xl font-bold tabular-nums text-brand">{pct(t.completed, t.target)}%</div>
            </div>
            <div className="mt-4"><ProgressBar value={t.completed} total={t.target} tone={t.completed >= t.target ? 'ok' : 'brand'} label="Today's progress" /></div>
            <p className="mt-3 text-sm text-soft">{t.completed >= t.target ? 'Target complete. Keep your momentum by reviewing a due question.' : `${t.target - t.completed} question${t.target - t.completed === 1 ? '' : 's'} left for today.`}</p>
          </>}
        </div>
        <div className="card">
          <div className="flex items-center justify-between"><h2 className="section-heading">Up next</h2><Link className="text-sm text-brand underline underline-offset-2" to="/today">View all</Link></div>
          {daily.data?.target === 0 ? <p className="mt-3 text-sm text-soft">Sunday is a holiday. There is nothing to complete today.</p> : daily.data?.assignments?.length ? <ul className="mt-3 divide-y divide-line">{daily.data.assignments.map((q) => <li key={q.id} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span className="min-w-0 truncate"><QuestionLink q={q} /></span><StatusBadge status={q.status} /></li>)}</ul> : <p className="mt-3 text-sm text-soft">{daily.loading ? "Loading today's questions…" : daily.error ? "Today's queue is unavailable right now. Open practice to try again." : 'Your daily questions will appear here.'}</p>}
        </div>
      </section>
      <Stagger className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Solved" value={data.total_solved} hint={`of ${data.total_questions}`} />
        <Stat label="Attempted, unsolved" value={data.total_attempted} />
        <Stat label="Remaining" value={data.questions_remaining} />
        <Link to="/revisions" className="block"><Stat label="Revision due today" value={data.revision_due} /></Link>
      </Stagger>
      <section className="card"><h2 className="mb-4 section-heading">Topic progress</h2><TopicBars topics={data.topics} /></section>
    </div>
  );
}
