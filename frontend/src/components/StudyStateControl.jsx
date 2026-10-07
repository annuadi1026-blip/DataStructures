import { useState } from 'react';
import { useStudyState } from '../context/StudyStateContext.jsx';
import { ErrorBox } from './ui.jsx';

export default function StudyStateControl() {
  const { studyState, loading, error, loadState, selectActiveSquad, pause, resume } = useStudyState();
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (action) => {
    setBusy(true);
    setActionError(null);
    try { await action(); } catch (err) { setActionError(err); }
    finally { setBusy(false); }
  };

  if (loading && !studyState) return <span role="status" className="hidden text-xs text-soft sm:inline">Loading study mode…</span>;
  if (error && !studyState) return <div className="max-w-56"><ErrorBox error={error} onRetry={loadState} /></div>;
  if (!studyState) return null;

  const activeName = studyState.mode === 'SQUAD' ? studyState.active_group?.name : 'Solo';
  const day = studyState.study_day;
  const canPause = studyState.mode === 'SOLO' || studyState.active_group?.my_role === 'owner';
  const canSelectSquad = studyState.available_groups?.length > 0;

  return (
    <div className="flex max-w-full flex-wrap items-center justify-end gap-1.5">
      <span title={`${activeName || 'Solo'}${day ? ` · Day ${day}` : ''}${studyState.paused ? ' · Paused' : ''}`} className="max-w-[6.5rem] truncate whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium text-ink sm:max-w-[11rem]" aria-live="polite">
        {activeName || 'Solo'}{day ? ` · Day ${day}` : ''}{studyState.paused ? ' · Paused' : ''}
      </span>
      {canSelectSquad && (
        <label className="sr-only" htmlFor="active-squad-select">Active study mode and squad</label>
      )}
      {canSelectSquad && (
        <select id="active-squad-select" className="input !min-h-8 !w-[5.5rem] !px-1 !py-1 text-xs sm:!w-auto sm:!px-2" value={studyState.active_group?.id || ''}
          disabled={busy} onChange={(e) => run(() => selectActiveSquad(e.target.value || null))}>
          <option value="">Solo mode</option>
          {studyState.available_groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
      )}
      {canPause && studyState.study?.initialized && (
        <button type="button" className="btn-ghost !min-h-8 !px-2 !py-1 text-xs" disabled={busy}
          aria-label={studyState.paused ? 'Resume study progression' : 'Pause study progression'}
          onClick={() => run(studyState.paused ? resume : pause)}>
          {studyState.paused ? 'Resume' : 'Pause'}
        </button>
      )}
      {(actionError || (error && studyState)) && <div className="w-full"><ErrorBox error={actionError || error} onRetry={loadState} /></div>}
    </div>
  );
}

export function SoloStudySetup() {
  const { studyState, chooseSoloStartingDay } = useStudyState();
  const [startingDay, setStartingDay] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!studyState?.needs_choose_solo_start) return null;

  const submit = async (event) => {
    event.preventDefault();
    const day = Number(startingDay);
    if (!Number.isInteger(day) || day < 1) {
      setError(new Error('Enter a positive whole-number study day.'));
      return;
    }
    setBusy(true);
    setError(null);
    try { await chooseSoloStartingDay(day); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };

  return (
    <section className="card mb-5 border-brand/20" aria-labelledby="solo-study-setup-title">
      <h2 id="solo-study-setup-title" className="section-heading">Choose your Solo starting day</h2>
      <p className="mt-1 text-sm text-soft">Your study state is not initialized yet. No daily assignments will be created until you choose a starting day.</p>
      <form onSubmit={submit} className="mt-4 flex max-w-sm flex-wrap items-end gap-3">
        <div className="w-36"><label className="label" htmlFor="solo-start-day">Starting day</label>
          <input id="solo-start-day" className="input" type="number" min="1" step="1" required placeholder="e.g. 5"
            value={startingDay} onChange={(event) => setStartingDay(event.target.value)} /></div>
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Start study'}</button>
      </form>
      <ErrorBox error={error} />
    </section>
  );
}
