import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, tokenStore } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { ErrorBox, PageTitle } from '../components/ui.jsx';

export default function Profile() {
  const { user, setUser, logout } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ displayName: user.display_name, username: user.username, email: user.email });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [del, setDel] = useState('');
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(null);
  const run = async (fn, ok) => { setErr(null); setMsg(''); try { await fn(); setMsg(ok); } catch (e) { setErr(e); } };
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageTitle title="Profile" />
      <ErrorBox error={err} />{msg && <p role="status" className="text-sm text-ok">{msg}</p>}
      <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => setUser((await api.patch('/users/me', f)).user), 'Profile updated'); }}>
        <h2 className="text-lg font-semibold">Your details</h2>
        <div><label className="label" htmlFor="p-dn">Display name</label><input id="p-dn" className="input" required value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></div>
        <div><label className="label" htmlFor="p-un">Username</label><input id="p-un" className="input" required pattern="[A-Za-z0-9_]+" minLength={3} maxLength={24} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></div>
        <div><label className="label" htmlFor="p-em">Email</label><input id="p-em" type="email" className="input" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <button className="btn-primary">Save changes</button>
      </form>
      <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { const d = await api.post('/users/me/password', pw); tokenStore.set(d.token); setPw({ currentPassword: '', newPassword: '' }); }, 'Password changed. Other devices were signed out.'); }}>
        <h2 className="text-lg font-semibold">Change password</h2>
        <div><label className="label" htmlFor="cp">Current password</label><input id="cp" type="password" className="input" required autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></div>
        <div><label className="label" htmlFor="np">New password</label><input id="np" type="password" className="input" required minLength={8} autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></div>
        <button className="btn-ghost">Change password</button>
      </form>
      <form className="card space-y-3 border-bad/40" onSubmit={(e) => { e.preventDefault(); if (!confirm('Delete your account and all your progress? This cannot be undone.')) return; run(async () => { await api.del('/users/me', { password: del }); tokenStore.clear(); await logout(); nav('/'); }, ''); }}>
        <h2 className="text-lg font-semibold text-bad">Delete account</h2>
        <p className="text-sm text-soft">This removes your progress, solutions and notifications permanently. Groups you own pass to another member.</p>
        <div><label className="label" htmlFor="dp">Confirm with your password</label><input id="dp" type="password" className="input" required value={del} onChange={(e) => setDel(e.target.value)} /></div>
        <button className="btn-danger">Delete my account</button>
      </form>
    </div>
  );
}
