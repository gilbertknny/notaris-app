'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api, errorText } from '@/lib/api';
import { Button, ErrorBox, Field, Input } from '@/components/ui';

type Step = { kind: 'password' } | { kind: 'code'; enrolled: true } | { kind: 'code'; enrolled: false; qr: string; secret: string };

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = await api<{ mfaEnrolled: boolean }>('/auth/login', { body: { email, password }, noRedirect: true });
      if (res.mfaEnrolled) {
        setStep({ kind: 'code', enrolled: true });
      } else {
        const setup = await api<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup', { method: 'POST', noRedirect: true });
        setStep({ kind: 'code', enrolled: false, secret: setup.secret, qr: await QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 180 }) });
      }
    });
  };

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/auth/mfa/verify', { body: { code }, noRedirect: true });
      await qc.invalidateQueries({ queryKey: ['me'] });
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
    });
  };

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,520px)]">
      <section className="hidden flex-col justify-between bg-ink p-12 text-white lg:flex">
        <p className="text-sm text-white/60">Aplikasi kantor Notaris & PPAT</p>
        <div className="max-w-md">
          <p className="text-3xl font-semibold leading-tight">Setiap berkas, dari penerimaan klien sampai laporan bulanan, di satu tempat.</p>
          <p className="mt-4 text-white/70">Repertorium dan klapper terisi saat akta diberi nomor. Data identitas klien tersimpan terenkripsi, dan setiap akses tercatat.</p>
        </div>
        <span className="stamp w-fit rounded-sm border-2 border-[#a993de] px-3 py-1 text-sm font-semibold text-[#cbbdf0]">Rahasia jabatan</span>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          {step.kind === 'password' ? (
            <form onSubmit={submitPassword} className="space-y-5">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Masuk</h1>
                <p className="mt-1 text-sm text-ink-soft">Gunakan akun staf kantor Anda.</p>
              </div>
              <ErrorBox>{error}</ErrorBox>
              <Field label="Email">
                <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              </Field>
              <Field label="Kata sandi">
                <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Button type="submit" className="w-full" disabled={busy}>
                Lanjut
              </Button>
              <p className="text-center text-sm text-ink-soft">
                Klien? <a href="/portal/login" className="text-stamp underline underline-offset-2">Masuk ke portal klien</a>
              </p>
            </form>
          ) : (
            <form onSubmit={submitCode} className="space-y-5">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{step.enrolled ? 'Kode verifikasi' : 'Aktifkan verifikasi dua langkah'}</h1>
                <p className="mt-1 text-sm text-ink-soft">
                  {step.enrolled
                    ? 'Buka aplikasi autentikator (Google Authenticator, Microsoft Authenticator, dll.) dan masukkan kode 6 digit.'
                    : 'Akun staf wajib memakai MFA. Pindai kode QR ini dengan aplikasi autentikator, lalu masukkan kode yang muncul.'}
                </p>
              </div>
              {!step.enrolled && (
                <div className="flex items-center gap-4 rounded-lg border border-rule bg-sheet p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={step.qr} alt="Kode QR untuk aplikasi autentikator" width={120} height={120} />
                  <div className="min-w-0 text-xs text-ink-soft">
                    Tidak bisa memindai? Masukkan kunci ini secara manual:
                    <code className="mt-1 block break-all text-sm text-ink">{step.secret}</code>
                  </div>
                </div>
              )}
              <ErrorBox>{error}</ErrorBox>
              <Field label="Kode 6 digit">
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
                Verifikasi dan masuk
              </Button>
              <button type="button" className="w-full text-sm text-ink-soft hover:text-ink" onClick={() => location.reload()}>
                Gunakan akun lain
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
