import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { api } from '../services/api.js';

const StudyStateContext = createContext(null);
export const useStudyState = () => useContext(StudyStateContext);

export function StudyStateProvider({ children }) {
  const { user } = useAuth();
  const [studyState, setStudyState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get('/study-state');
      setStudyState(result);
      return result;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.get('/study-state').then((result) => {
      if (active) setStudyState(result);
    }).catch((err) => {
      if (active) setError(err);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [user?.id]);

  const refreshAll = useCallback(async () => {
    window.dispatchEvent(new Event('study-state:refresh-related'));
    const [next] = await Promise.all([
      api.get('/study-state'), api.get('/daily'), api.get('/progress'),
    ]);
    setStudyState(next);
    setError(null);
    return next;
  }, []);

  const applyPartialState = useCallback((result) => {
    if (result?.available_groups) {
      setStudyState(result);
      return;
    }
    setStudyState((current) => {
      if (!current || !result) return current;
      const group = result.mode === 'SQUAD' && current.active_group
        ? { ...current.active_group, study_day: result.study_day, paused: result.paused }
        : current.active_group;
      const solo = result.mode === 'SOLO' && current.solo
        ? { ...current.solo, study_day: result.study_day, initialized: result.initialized ?? true, paused: result.paused }
        : current.solo;
      return {
        ...current,
        ...(result.mode ? { mode: result.mode } : {}),
        ...(result.study_day !== undefined ? { study_day: result.study_day } : {}),
        ...(result.paused !== undefined ? { paused: result.paused } : {}),
        active_group: result.mode === 'SOLO' ? null : group,
        solo,
        study: { ...current.study, study_day: result.study_day ?? current.study?.study_day,
          initialized: result.initialized ?? current.study?.initialized, paused: result.paused ?? current.study?.paused },
        needs_choose_solo_start: result.needs_choose_solo_start
          ?? (result.mode === 'SOLO' && result.initialized ? false : current.needs_choose_solo_start),
      };
    });
  }, []);

  const mutate = useCallback(async (promise) => {
    const result = await promise;
    applyPartialState(result);
    await refreshAll();
    return result;
  }, [applyPartialState, refreshAll]);

  const value = useMemo(() => ({
    studyState, loading, error, loadState, refreshAll,
    selectActiveSquad: (groupId) => mutate(api.put('/study-state/active-squad', { group_id: groupId })),
    chooseSoloStartingDay: (startingDay) => mutate(api.put('/study-state/solo-start', { starting_day: startingDay })),
    pause: () => mutate(api.post('/study-state/pause')),
    resume: () => mutate(api.post('/study-state/resume')),
  }), [studyState, loading, error, loadState, refreshAll, mutate]);

  return <StudyStateContext.Provider value={value}>{children}</StudyStateContext.Provider>;
}
