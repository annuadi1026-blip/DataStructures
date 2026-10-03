import { Link } from 'react-router-dom';
import { STATUS, pct } from '../utils/format.js';
import { useCountUp } from '../hooks/useCountUp.js';

export function ProgressBar({ value, total, tone = 'brand', label }) {
  const p = pct(value, total);
  const color = { brand: 'bg-brand', ok: 'bg-ok', warn: 'bg-warn' }[tone];
  return (
    <div role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label={label || 'Progress'} className="h-2.5 w-full overflow-hidden rounded-full bg-line/70">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${p}%` }} />
    </div>
  );
}

export const StatusBadge = ({ status }) => (
  <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS[status]?.cls}`}>{STATUS[status]?.label}</span>
);

export const SourceBadges = ({ badges = [] }) => (
  <span className="inline-flex gap-1" aria-label={`Sources: ${badges.map((b) => (b === 'N' ? 'NeetCode' : 'Striver')).join(', ')}`}>
    {badges.map((b) => (
      <span key={b} title={b === 'N' ? 'NeetCode 150' : 'Striver Master DSA Patterns'}
        className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-medium ${b === 'N' ? 'bg-brand-tint text-brand' : 'bg-warn-tint text-warn'}`}>[{b}]</span>
    ))}
  </span>
);

export function ExternalLinks({ q }) {
  const items = [['LeetCode', q.leetcode_url], ['NeetCode', q.neetcode_url], ['Striver', q.striver_url], ['YouTube', q.youtube_url]].filter(([, u]) => u);
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(([name, url]) => (
        <a key={name} href={url} target="_blank" rel="noopener noreferrer" className="btn-ghost !px-2.5 !py-1 text-xs">{name}</a>
      ))}
    </div>
  );
}

export const Spinner = ({ label = 'Loading' }) => <div role="status" className="py-10 text-center text-sm text-soft">{label}...</div>;

export const Skeleton = ({ className = '' }) => <div aria-hidden="true" className={`skeleton ${className}`} />;

export function PageSkeleton({ rows = 3 }) {
  return <div className="space-y-4" aria-label="Loading content" role="status"><Skeleton className="h-9 w-52" />{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-28 w-full" />)}<span className="sr-only">Loading...</span></div>;
}

export const ErrorBox = ({ error, onRetry }) => error ? (
  <div role="alert" className="rounded-lg border border-bad/30 bg-bad-tint p-3 text-sm text-bad">
    {error.message || String(error)} {onRetry && <button className="ml-2 underline" onClick={onRetry}>Try again</button>}
  </div>
) : null;

export const Empty = ({ title, children }) => (
  <div className="rounded-xl border border-dashed border-line bg-white/60 p-8 text-center">
    <p className="font-display text-lg font-semibold">{title}</p>
    <div className="mt-1 text-sm text-soft">{children}</div>
  </div>
);

export const PageTitle = ({ title, children }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
    {children}
  </div>
);

export const Stat = ({ label, value, hint }) => (
  <div className="card !p-4">
    <div className="font-display text-3xl font-bold tabular-nums"><CountedValue value={value} /></div>
    <div className="text-sm text-soft">{label}</div>
    {hint && <div className="mt-1 text-xs text-soft">{hint}</div>}
  </div>
);

function CountedValue({ value }) {
  const numeric = typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value));
  const shown = useCountUp(numeric ? Number(value) : 0);
  return numeric ? shown : value;
}

export const QuestionLink = ({ q, children }) => <Link to={`/questions/${q.id}`} className="font-medium hover:text-brand hover:underline">{children || q.title}</Link>;
