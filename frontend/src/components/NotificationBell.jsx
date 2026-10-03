import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { timeAgo } from '../utils/format.js';

export default function NotificationBell() {
  const [data, setData] = useState({ unread_count: 0, items: [] });
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const load = () => api.get('/notifications?limit=8').then(setData).catch(() => {});

  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const away = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, []);

  const markAll = async () => { await api.patch('/notifications/read-all'); load(); };
  const markOne = async (n) => { if (!n.read_at) { await api.patch(`/notifications/${n.id}/read`); load(); } };

  return (
    <div className="relative" ref={box}>
      <button className="btn-ghost relative" aria-label={`Notifications, ${data.unread_count} unread`} aria-expanded={open} onClick={() => { setOpen(!open); load(); }}>
        <span aria-hidden>🔔</span>
        {data.unread_count > 0 && <span className="rounded-full bg-bad px-1.5 text-xs font-bold text-white">{data.unread_count}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 max-w-[90vw] rounded-xl border border-line bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="font-display font-semibold">Notifications</span>
            {data.unread_count > 0 && <button onClick={markAll} className="text-xs text-brand underline">Mark all read</button>}
          </div>
          <ul className="max-h-80 divide-y divide-line overflow-auto">
            {data.items.length === 0 && <li className="p-4 text-sm text-soft">Nothing yet. Nudges and reminders will show up here.</li>}
            {data.items.map((n) => (
              <li key={n.id}>
                <button onClick={() => markOne(n)} className={`block w-full whitespace-pre-line px-4 py-2.5 text-left text-sm hover:bg-paper ${n.read_at ? 'text-soft' : 'font-medium'}`}>
                  {!n.read_at && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand" aria-label="unread" />}
                  {n.message}
                  <span className="mt-0.5 block text-xs font-normal text-soft">{timeAgo(n.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2.5 text-center text-sm text-brand hover:bg-paper">See all notifications</Link>
        </div>
      )}
    </div>
  );
}
