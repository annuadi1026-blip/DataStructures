import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Landing() {
  const { user } = useAuth();
  if (user) return <Navigate to="/dashboard" replace />;
  return (
    <div className="mx-auto max-w-4xl px-5 py-16 sm:py-24">
      <p className="font-display text-lg font-semibold text-brand">DSA Squad</p>
      <h1 className="mt-3 max-w-3xl text-4xl font-bold leading-[1.05] sm:text-6xl">Two problems a day. Your friends can see if you skipped.</h1>
      <p className="mt-5 max-w-2xl text-lg text-soft">
        Work through the NeetCode 150 and Striver patterns in roadmap order, write down how you solved each one, revise on a schedule,
        and keep each other honest with a private squad.
      </p>
      <div className="mt-8 flex gap-3">
        <Link to="/register" className="btn-primary !px-5 !py-3 text-base">Create account</Link>
        <Link to="/login" className="btn-ghost !px-5 !py-3 text-base">Log in</Link>
      </div>
      <div className="mt-14 grid gap-4 sm:grid-cols-3">
        {[['269 questions', 'Deduplicated from both lists, grouped by pattern, with the original links.'],
          ['Your own write-ups', 'Approach, code, complexity, mistakes and what you learned. Private unless you share it.'],
          ['Gentle accountability', 'Friends get a note when you are behind and can nudge you. No leaderboards.']].map(([t, d]) => (
          <div key={t} className="card"><h2 className="text-lg font-semibold">{t}</h2><p className="mt-1 text-sm text-soft">{d}</p></div>
        ))}
      </div>
    </div>
  );
}
