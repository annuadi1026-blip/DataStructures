import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Landing() {
  const { user } = useAuth();
  if (user) return <Navigate to="/dashboard" replace />;
  return (
    <div className="mx-auto max-w-6xl px-5 py-14 sm:py-24">
      <header className="flex items-center justify-between border-b border-line pb-5">
        <span className="font-display text-xl font-bold">DSA Squad</span>
        <Link to="/login" className="text-sm font-medium text-brand underline underline-offset-2">Log in</Link>
      </header>
      <div className="grid gap-10 py-14 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-end">
        <div>
          <p className="eyebrow text-brand">Deliberate practice, together</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold leading-[1.05] sm:text-6xl">Two problems a day. A record you can learn from.</h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-soft">Work through the NeetCode 150 and Striver patterns in roadmap order, write down how you solved each one, revise on a schedule, and keep each other honest with a private squad.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/register" className="btn-primary !px-5 !py-3 text-base">Create account</Link>
            <Link to="/login" className="btn-ghost !px-5 !py-3 text-base">Log in</Link>
          </div>
        </div>
        <dl className="border-y border-line text-sm">
          <div className="border-b border-line py-4"><dt className="font-semibold">Practice</dt><dd className="mt-1 text-soft">A focused daily queue, in roadmap order.</dd></div>
          <div className="border-b border-line py-4"><dt className="font-semibold">Reflect</dt><dd className="mt-1 text-soft">Keep approaches, complexity, mistakes, and learnings alongside each problem.</dd></div>
          <div className="py-4"><dt className="font-semibold">Return</dt><dd className="mt-1 text-soft">Use a revision schedule and a small squad to stay accountable.</dd></div>
        </dl>
      </div>
    </div>
  );
}
