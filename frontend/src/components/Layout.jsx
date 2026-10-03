import { useState } from 'react';
import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import NotificationBell from './NotificationBell.jsx';
import { Spinner } from './ui.jsx';
import { PageTransition } from './motion.jsx';

const NAV = [
  ['/dashboard', 'Dashboard'], ['/today', "Today's two"], ['/roadmap', 'Roadmap'], ['/questions', 'All questions'],
  ['/revisions', 'Revisions'], ['/progress', 'My progress'], ['/group', 'Squad'], ['/group/members', 'Members'],
  ['/notifications', 'Notifications'], ['/settings', 'Settings'], ['/profile', 'Profile'],
];

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <Layout />;
}

function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const links = (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(([to, label]) => (
        <NavLink key={to} to={to} end={to === '/group'} viewTransition onClick={() => setOpen(false)}
          className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-medium transition-[background-color,color,transform] duration-150 ${isActive ? 'bg-brand text-white shadow-sm' : 'text-ink hover:bg-brand-tint active:scale-[.98]'}`}>{label}</NavLink>
      ))}
    </nav>
  );
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col justify-between border-r border-line bg-white/70 p-4 backdrop-blur md:flex">
        <div>
          <div className="mb-6 px-3 font-display text-xl font-bold">DSA Squad</div>
          {links}
        </div>
        <div className="px-3 text-xs text-soft">
          <div className="truncate font-medium text-ink">{user.display_name}</div>
          <button onClick={logout} className="mt-1 underline">Log out</button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-paper/90 px-4 py-2.5 backdrop-blur">
          <button className="btn-ghost md:hidden" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(!open)}>Menu</button>
          <span className="font-display font-bold md:hidden">DSA Squad</span>
          <div className="ml-auto"><NotificationBell /></div>
        </header>
        {open && <div className="border-b border-line bg-white p-3 md:hidden">{links}<button onClick={logout} className="mt-2 px-3 text-sm underline">Log out</button></div>}
        <main className="p-4 sm:p-6"><PageTransition><Outlet /></PageTransition></main>
      </div>
    </div>
  );
}
