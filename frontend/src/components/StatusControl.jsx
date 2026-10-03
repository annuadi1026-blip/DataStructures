import { useState } from 'react';
import { api } from '../services/api.js';
import { STATUS, STATUS_ORDER } from '../utils/format.js';

/** Five-state status selector. onChange receives the updated question. */
export default function StatusControl({ question, onChange }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const set = async (status) => {
    if (status === question.status) return;
    setBusy(true); setErr(''); setNotice('');
    try { const d = await api.patch(`/progress/${question.id}`, { status }); setNotice(status === 'SOLVED' ? 'Problem solved ✓' : 'Progress updated'); onChange?.(d.question); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div role="group" aria-label="Question status" className="flex flex-wrap gap-1.5">
        {STATUS_ORDER.map((s) => (
          <button key={s} disabled={busy} aria-pressed={question.status === s} onClick={() => set(s)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${question.status === s ? 'border-brand bg-brand text-white' : 'border-line bg-white hover:bg-brand-tint'}`}>
            {STATUS[s].label}
          </button>
        ))}
      </div>
      {err && <p role="alert" className="mt-1 text-xs text-bad">{err}</p>}
      {notice && <p role="status" className="mt-1 text-xs font-medium text-ok">{notice}</p>}
    </div>
  );
}
