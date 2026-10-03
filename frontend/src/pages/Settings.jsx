import { useState } from 'react';
import { api } from '../services/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { ErrorBox, PageTitle, Spinner } from '../components/ui.jsx';

const OPTIONS = [
  ['personal_daily_reminder', 'Personal daily reminders', 'A reminder (and revision-due notes) when you still have questions left today.'],
  ['friend_pending', "Notify me when friends haven't completed their daily target", 'Friends in your groups who are behind show up in your notifications.'],
  ['friend_completed', 'Notify me when friends complete their daily target', 'A short note when a group member finishes both questions.'],
  ['allow_nudges', 'Allow friends to nudge me', 'Group members can send you a nudge while you are behind.'],
  ['daily_group_summary', 'Daily group summary', "One evening summary of everyone's progress."],
];

export default function Settings() {
  const { data, error, loading, reload } = useAsync(() => api.get('/notification-preferences'));
  const [err, setErr] = useState(null); const [saved, setSaved] = useState('');
  const [local, setLocal] = useState(null);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const prefs = local || data.preferences;
  const toggle = async (k) => {
    setErr(null); setSaved('');
    const next = { ...prefs, [k]: !prefs[k] }; setLocal(next);
    try { await api.patch('/notification-preferences', { [k]: next[k] }); setSaved('Saved'); } catch (e) { setErr(e); setLocal(prefs); }
  };
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Notification settings" />
      <ErrorBox error={err} />
      <ul className="card divide-y divide-line !p-0">
        {OPTIONS.map(([k, label, hint]) => (
          <li key={k} className="p-4"><label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={!!prefs[k]} onChange={() => toggle(k)} />
            <span><span className="block font-medium">{label}</span><span className="text-sm text-soft">{hint}</span></span></label></li>
        ))}
      </ul>
      <p role="status" className="mt-3 text-sm text-ok">{saved}</p>
    </div>
  );
}
