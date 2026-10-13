export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

type Opts = { method?: string; body?: unknown; form?: FormData; noRedirect?: boolean };

let reauthHandler: (() => Promise<boolean>) | null = null;
/** Dipasang oleh <ReauthProvider>: tampilkan dialog kode MFA, kembalikan true bila berhasil. */
export function setReauthHandler(fn: typeof reauthHandler) {
  reauthHandler = fn;
}

const LOGIN_CODES = new Set(['UNAUTHENTICATED', 'SESSION_EXPIRED', 'MFA_REQUIRED']);

export async function api<T = unknown>(path: string, opts: Opts = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'notaris-web' };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api/v1${path}`, {
    method: opts.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (res.ok) {
    const type = res.headers.get('content-type') ?? '';
    return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
  }
  const err = await res.json().catch(() => ({ code: 'HTTP_ERROR', message: `Permintaan gagal (${res.status})` }));
  if (err.code === 'MFA_REAUTH_REQUIRED' && reauthHandler && !retried) {
    if (await reauthHandler()) return api<T>(path, opts, true);
  }
  if (res.status === 401 && LOGIN_CODES.has(err.code) && !opts.noRedirect && typeof window !== 'undefined') {
    const portal = window.location.pathname.startsWith('/portal');
    const target = portal ? '/portal/login' : '/login';
    if (window.location.pathname !== target) window.location.href = `${target}?next=${encodeURIComponent(window.location.pathname)}`;
  }
  throw new ApiError(err.code, err.message, res.status, err.details);
}

/** Pesan error yang bisa ditampilkan; detail validasi digabung per kolom. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'VALIDATION' && Array.isArray(e.details)) {
      return (e.details as { path: string; message: string }[]).map((d) => d.message).join(' · ');
    }
    return e.message;
  }
  return 'Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.';
}
