import { useState } from 'react';
import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import NotificationBell from './NotificationBell.jsx';
import { Spinner } from './ui.jsx';
import { PageTransition } from './motion.jsx';

const NAV = [
  ['Practice', [['/dashboard', 'Overview'], ['/today', "Today's two"], ['/roadmap', 'Roadmap'], ['/questions', 'Question library'], ['/revisions', 'Revisions'], ['/progress', 'My progress']]],
  ['Squad', [['/group', 'Squad activity'], ['/group/members', 'Members']]],
  ['Account', [['/notifications', 'Notifications'], ['/settings', 'Settings'], ['/profile', 'Profile']]],
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
    <nav aria-label="Main" className="space-y-5">
      {NAV.map(([group, items]) => (
        <div key={group}>
          <p className="eyebrow mb-1 px-3">{group}</p>
          <div className="flex flex-col gap-0.5">
            {items.map(([to, label]) => (
              <NavLink key={to} to={to} end={to === '/group'} viewTransition onClick={() => setOpen(false)}
                className={({ isActive }) => `rounded-md px-3 py-2 text-sm font-medium transition-[background-color,color,transform] duration-150 ${isActive ? 'bg-brand text-white shadow-sm' : 'text-ink hover:bg-brand-tint active:scale-[.98]'}`}>{label}</NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
  return (
    <div className="mx-auto flex min-h-screen max-w-[1440px]">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between border-r border-line bg-white p-4 md:flex">
        <div>
          <div className="mb-8 px-3"><div className="font-display text-xl font-bold leading-none">DSA Squad</div><div className="mt-1 text-xs text-soft">Practice with intent</div></div>
          {links}
        </div>
        <div className="border-t border-line px-3 pt-4 text-xs text-soft">
          <div className="truncate font-medium text-ink">{user.display_name}</div>
          <div className="truncate">@{user.username}</div>
          <button onClick={logout} className="mt-2 text-ink underline underline-offset-2">Log out</button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between border-b border-line bg-[#F3F5F8]/95 px-4 backdrop-blur md:px-6">
          <button className="btn-ghost md:hidden" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close' : 'Menu'}</button>
          <span className="font-display font-bold md:hidden">DSA Squad</span>
          <div className="ml-auto"><NotificationBell /></div>
        </header>
        {open && <div className="border-b border-line bg-white p-4 md:hidden">{links}<button onClick={logout} className="mt-4 px-3 text-sm underline">Log out</button></div>}
        <main className="p-4 sm:p-6 lg:p-8"><PageTransition><Outlet /></PageTransition></main>
      </div>
    </div>
  );
}
