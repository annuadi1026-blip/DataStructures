import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore } from '../services/api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!tokenStore.get());

  useEffect(() => {
    if (!tokenStore.get()) return;
    api.get('/auth/me').then((d) => setUser(d.user)).catch(() => tokenStore.clear()).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const h = () => setUser(null);
    window.addEventListener('auth:expired', h);
    return () => window.removeEventListener('auth:expired', h);
  }, []);

  const finish = (d) => { tokenStore.set(d.token); setUser(d.user); };
  const value = useMemo(() => ({
    user, loading, setUser,
    login: async (email, password) => finish(await api.post('/auth/login', { email, password })),
    register: async (form) => finish(await api.post('/auth/register', form)),
    logout: async () => { try { await api.post('/auth/logout'); } catch { /* ignore */ } tokenStore.clear(); setUser(null); },
  }), [user, loading]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useActiveGroup = () => {
  const [id, setId] = useState(localStorage.getItem('dsa_group') || '');
  const set = useCallback((v) => { v ? localStorage.setItem('dsa_group', v) : localStorage.removeItem('dsa_group'); setId(v); }, []);
  return [id, set];
};
