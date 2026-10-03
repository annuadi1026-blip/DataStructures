import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { useAuth } from '../context/AuthContext.jsx';
import { ErrorBox, PageSkeleton, PageTitle, ProgressBar, Stat } from '../components/ui.jsx';
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
  if (loading) return <PageSkeleton rows={3} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const t = data.today;
  return (
    <div>
      <PageTitle title={`Hi ${user.display_name}`}><Link to="/today" className="btn-primary">Open today's two</Link></PageTitle>
      <section className="card mb-5" aria-label="Today's progress">
        <div className="flex items-end justify-between">
          <div><div className="text-sm text-soft">Today</div><div className="font-display text-3xl font-bold tabular-nums">{t.completed} / {t.target} completed</div></div>
          <div className="font-display text-2xl font-bold tabular-nums text-brand">{pct(t.completed, t.target)}%</div>
        </div>
        <div className="mt-3"><ProgressBar value={t.completed} total={t.target} tone={t.completed >= t.target ? 'ok' : 'brand'} label="Today's progress" /></div>
      </section>
      <Stagger className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Solved" value={data.total_solved} hint={`of ${data.total_questions}`} />
        <Stat label="Attempted, unsolved" value={data.total_attempted} />
        <Stat label="Remaining" value={data.questions_remaining} />
        <Stat label="Current streak" value={data.current_streak} hint="days" />
        <Stat label="Longest streak" value={data.longest_streak} hint="days" />
        <Link to="/revisions" className="block"><Stat label="Revision due today" value={data.revision_due} /></Link>
      </Stagger>
      <section className="card"><h2 className="mb-4 text-lg font-semibold">Topic progress</h2><TopicBars topics={data.topics} /></section>
    </div>
  );
}
