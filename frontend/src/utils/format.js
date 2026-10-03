export const STATUS = {
  NOT_STARTED: { label: 'Not started', cls: 'bg-paper text-soft border-line' },
  ATTEMPTED: { label: 'Attempted', cls: 'bg-warn-tint text-warn border-warn/30' },
  SOLVED: { label: 'Solved', cls: 'bg-ok-tint text-ok border-ok/30' },
  NEEDS_REVISION: { label: 'Needs revision', cls: 'bg-bad-tint text-bad border-bad/30' },
  REVISED: { label: 'Revised', cls: 'bg-brand-tint text-brand border-brand/30' },
};
export const STATUS_ORDER = Object.keys(STATUS);
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
export const fmtDate = (d) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
export const timeAgo = (iso) => {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
