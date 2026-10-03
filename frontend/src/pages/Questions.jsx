import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { useAsync } from '../hooks/useAsync.js';
import { Empty, ErrorBox, PageSkeleton, PageTitle, SourceBadges, StatusBadge, QuestionLink } from '../components/ui.jsx';
import { STATUS, STATUS_ORDER } from '../utils/format.js';

export default function Questions() {
  const [f, setF] = useState({ q: '', topic: '', source: '', status: '', solved: '', revisionDue: '' });
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setF((x) => ({ ...x, q })), 250); return () => clearTimeout(t); }, [q]);
  const topics = useAsync(() => api.get('/topics'));
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { data, error, loading, reload } = useAsync(() => api.get(`/questions${qs ? `?${qs}` : ''}`), [qs]);
  const sel = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const Select = ({ k, label, children }) => (
    <div><label className="label" htmlFor={`f-${k}`}>{label}</label><select id={`f-${k}`} className="input" value={f[k]} onChange={sel(k)}>{children}</select></div>
  );
  return (
    <div>
      <PageTitle title="All questions" />
      <div className="card mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2"><label className="label" htmlFor="search">Search</label><input id="search" type="search" className="input" placeholder="e.g. two sum" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select k="topic" label="Topic"><option value="">All topics</option>{topics.data?.topics.map((t) => <option key={t.topic}>{t.topic}</option>)}</Select>
        <Select k="source" label="Source"><option value="">Any</option><option value="NEETCODE">NeetCode</option><option value="STRIVER">Striver</option><option value="BOTH">In both</option></Select>
        <Select k="status" label="Status"><option value="">Any</option>{STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}</Select>
        <Select k="solved" label="Solved"><option value="">All</option><option value="true">Solved</option><option value="false">Unsolved</option></Select>
        <Select k="revisionDue" label="Revision"><option value="">All</option><option value="true">Due now</option></Select>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <PageSkeleton rows={4} />}
      {data && (
        <>
          <p className="mb-2 text-sm text-soft" aria-live="polite">{data.total} question{data.total === 1 ? '' : 's'}</p>
          {data.items.length === 0 ? <Empty title="No questions match">Try clearing a filter.</Empty> : (
            <div className="card overflow-x-auto !p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-soft"><tr><th className="p-3 font-medium">Question</th><th className="p-3 font-medium">Topic</th><th className="p-3 font-medium">Source</th><th className="p-3 font-medium">Status</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {data.items.map((x) => (
                    <tr key={x.id}><td className="p-3"><QuestionLink q={x} /></td><td className="p-3 text-soft">{x.topic}</td><td className="p-3"><SourceBadges badges={x.badges} /></td><td className="p-3"><StatusBadge status={x.status} /></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
