'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorText } from '@/lib/api';
import { Button, ErrorBox, Field, Input } from '@/components/ui';

export default function PortalLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Portal klien</h1>
        {step === 'email' ? (
          <form
            className="mt-6 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api('/portal/auth/otp', { body: { email }, noRedirect: true });
                setStep('code');
              });
            }}
          >
            <p className="text-sm text-ink-soft">Pantau berkas Anda dan kirim dokumen yang diminta kantor notaris. Kami kirim kode masuk ke email Anda.</p>
            <ErrorBox>{error}</ErrorBox>
            <Field label="Email yang terdaftar di kantor notaris">
              <Input type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button type="submit" className="w-full" disabled={busy}>
              Kirim kode
            </Button>
          </form>
        ) : (
          <form
            className="mt-6 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api('/portal/auth/verify', { body: { email, code }, noRedirect: true });
                router.replace('/portal');
              });
            }}
          >
            <p className="text-sm text-ink-soft">
              Jika <span className="font-medium text-ink">{email}</span> terdaftar, kode 6 digit sudah dikirim. Kode berlaku 5 menit.
            </p>
            <ErrorBox>{error}</ErrorBox>
            <Field label="Kode masuk">
              <Input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="text-lg tracking-[0.3em]"
              />
            </Field>
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
              Masuk
            </Button>
            <button type="button" className="w-full text-sm text-ink-soft hover:text-ink" onClick={() => setStep('email')}>
              Ganti email atau kirim ulang kode
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
