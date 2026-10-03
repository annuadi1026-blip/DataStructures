import { api } from '../services/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { Empty, ErrorBox, PageTitle, Spinner } from '../components/ui.jsx';
import { timeAgo } from '../utils/format.js';

export default function Notifications() {
  const { data, error, loading, reload } = useAsync(() => api.get('/notifications?limit=100'));
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const read = async (n) => { if (!n.read_at) { await api.patch(`/notifications/${n.id}/read`); reload(); } };
  const all = async () => { await api.patch('/notifications/read-all'); reload(); };
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title="Notifications">{data.unread_count > 0 && <button className="btn-ghost" onClick={all}>Mark all read ({data.unread_count})</button>}</PageTitle>
      {data.items.length === 0 ? <Empty title="No notifications yet">Reminders, nudges and your group's daily summary will show up here.</Empty> : (
        <ul className="card divide-y divide-line !p-0">
          {data.items.map((n) => (
            <li key={n.id}>
              <button onClick={() => read(n)} className={`block w-full whitespace-pre-line px-4 py-3 text-left text-sm hover:bg-paper ${n.read_at ? 'text-soft' : 'font-medium'}`}>
                {!n.read_at && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-brand" aria-label="unread" />}{n.message}
                <span className="mt-1 block text-xs font-normal text-soft">{timeAgo(n.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
