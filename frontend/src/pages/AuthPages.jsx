import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { ErrorBox } from '../components/ui.jsx';

function Shell({ title, children, footer }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <Link to="/" className="mb-6 font-display text-xl font-bold">DSA Squad</Link>
      <div className="card"><h1 className="mb-4 text-2xl font-bold">{title}</h1>{children}</div>
      <p className="mt-4 text-center text-sm text-soft">{footer}</p>
    </div>
  );
}

export function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate(); const loc = useLocation();
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/dashboard" replace />;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await login(f.email, f.password); nav(loc.state?.from || '/dashboard', { replace: true }); }
    catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <Shell title="Log in" footer={<>New here? <Link className="text-brand underline" to="/register">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label" htmlFor="email">Email or username</label><input id="email" className="input" autoComplete="username" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div><label className="label" htmlFor="pw">Password</label><input id="pw" type="password" className="input" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
        <ErrorBox error={err} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Logging in...' : 'Log in'}</button>
      </form>
    </Shell>
  );
}

export function Register() {
  const { user, register } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ displayName: '', username: '', email: '', password: '' });
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/dashboard" replace />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await register(f); nav('/dashboard', { replace: true }); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <Shell title="Create your account" footer={<>Already registered? <Link className="text-brand underline" to="/login">Log in</Link></>}>
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label" htmlFor="dn">Name your friends will see</label><input id="dn" className="input" required maxLength={60} value={f.displayName} onChange={set('displayName')} /></div>
        <div><label className="label" htmlFor="un">Username</label><input id="un" className="input" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" title="Letters, digits and underscores" autoComplete="username" value={f.username} onChange={set('username')} /></div>
        <div><label className="label" htmlFor="em">Email</label><input id="em" type="email" className="input" required autoComplete="email" value={f.email} onChange={set('email')} /></div>
        <div><label className="label" htmlFor="pw">Password</label><input id="pw" type="password" className="input" required minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} /><p className="mt-1 text-xs text-soft">At least 8 characters with a letter and a digit.</p></div>
        <ErrorBox error={err} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating...' : 'Create account'}</button>
      </form>
    </Shell>
  );
}
