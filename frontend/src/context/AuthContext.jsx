import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore } from '../services/api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

const USER_KEY = 'dsa_user';
function savedUser() {
  try {
    const user = JSON.parse(sessionStorage.getItem(USER_KEY));
    return user?.id ? user : null;
  } catch {
    sessionStorage.removeItem(USER_KEY);
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(savedUser);
  const [loading, setLoading] = useState(() => !!tokenStore.get() && !savedUser());

  const setUser = useCallback((next) => {
    setUserState((current) => {
      const value = typeof next === 'function' ? next(current) : next;
      if (value) sessionStorage.setItem(USER_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(USER_KEY);
      return value;
    });
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) { setLoading(false); return; }
    // The saved profile only unblocks rendering. Every API request remains
    // server-authenticated, and this request refreshes or clears it promptly.
    api.get('/auth/me').then((d) => setUser(d.user)).catch(() => { tokenStore.clear(); setUser(null); }).finally(() => setLoading(false));
  }, [setUser]);
  useEffect(() => {
    const h = () => setUser(null);
    window.addEventListener('auth:expired', h);
    return () => window.removeEventListener('auth:expired', h);
  }, [setUser]);

  const finish = (d) => { tokenStore.set(d.token); setUser(d.user); };
  const value = useMemo(() => ({
    user, loading, setUser,
    login: async (email, password) => finish(await api.post('/auth/login', { email, password })),
    register: async (form) => finish(await api.post('/auth/register', form)),
    logout: async () => { try { await api.post('/auth/logout'); } catch { /* ignore */ } tokenStore.clear(); setUser(null); },
  }), [user, loading, setUser]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useActiveGroup = () => {
  const [id, setId] = useState(localStorage.getItem('dsa_group') || '');
  const set = useCallback((v) => { v ? localStorage.setItem('dsa_group', v) : localStorage.removeItem('dsa_group'); setId(v); }, []);
  return [id, set];
};
