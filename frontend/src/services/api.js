// The frontend only ever talks to the Express API. Base URL comes from VITE_API_URL.
const BASE = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000' : '')).replace(/\/$/, '');
const TOKEN_KEY = 'dsa_token';

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function request(method, path, body) {
  if (!BASE && !import.meta.env.DEV) throw new ApiError(0, 'NO_API_URL', 'VITE_API_URL is not configured for this build');
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. If it is hosted on a free plan it may be waking up, try again in a minute.');
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok || !json?.success) {
    const e = json?.error || {};
    if (res.status === 401 && token) { tokenStore.clear(); window.dispatchEvent(new Event('auth:expired')); }
    throw new ApiError(res.status, e.code || 'REQUEST_FAILED', e.message || `Request failed (${res.status})`);
  }
  return json.data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  put: (p, b = {}) => request('PUT', p, b),
  patch: (p, b = {}) => request('PATCH', p, b),
  del: (p, b) => request('DELETE', p, b),
};
