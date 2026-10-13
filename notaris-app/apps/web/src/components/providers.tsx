'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, errorText, setReauthHandler } from '@/lib/api';
import { Button, Field, Input } from './ui';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true, staleTime: 10_000 } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ReauthDialog />
      {children}
    </QueryClientProvider>
  );
}

/** Dialog MFA ulang untuk aksi sensitif (setujui draf, beri nomor akta, kunci bulan, buat akun). */
function ReauthDialog() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    setReauthHandler(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setCode('');
          setError(null);
          setOpen(true);
        }),
    );
    return () => setReauthHandler(null);
  }, []);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  const finish = (ok: boolean) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/mfa/verify', { body: { code } });
      finish(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} onCancel={() => finish(false)} className="m-auto w-full max-w-sm rounded-lg border border-rule bg-sheet p-6 text-ink backdrop:bg-ink/40">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Konfirmasi dengan kode MFA</h2>
          <p className="mt-1 text-sm text-ink-soft">Aksi ini mengikat secara hukum. Masukkan kode 6 digit dari aplikasi autentikator Anda.</p>
        </div>
        <Field label="Kode MFA" error={error}>
          <Input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="quiet" onClick={() => finish(false)}>
            Batal
          </Button>
          <Button type="submit" disabled={code.length !== 6 || busy}>
            Konfirmasi
          </Button>
        </div>
      </form>
    </dialog>
  );
}
