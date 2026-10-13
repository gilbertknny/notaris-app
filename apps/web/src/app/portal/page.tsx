'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DOCUMENT_KINDS, MatterStatus } from '@notaris/shared';
import { api, errorText } from '@/lib/api';
import { rupiah, waktu } from '@/lib/format';
import { Button, Empty, ErrorBox, Field, Input, Loading, Pill, Select, StatusRail } from '@/components/ui';

interface PortalMatter {
  id: string;
  code: string;
  title: string;
  status: MatterStatus;
  statusLabel: string;
  nextStep: string;
  role: string;
  documents: { id: string; kind: string; kindLabel: string; filename: string; status: string; createdAt: string }[];
  invoices: { id: string; number: string; amount: string; taxEscrow: string; status: string; paid: string }[];
  appointments: { id: string; startsAt: string; room: string | null }[];
}

export default function PortalHome() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['portal-me'], queryFn: () => api<{ fullName: string; office: { name: string; notaryName: string } }>('/portal/me') });
  const matters = useQuery({ queryKey: ['portal-matters'], queryFn: () => api<PortalMatter[]>('/portal/matters') });

  const logout = async () => {
    await api('/portal/auth/logout', { method: 'POST', noRedirect: true }).catch(() => undefined);
    qc.clear();
    router.replace('/portal/login');
  };

  if (me.isLoading || matters.isLoading) return <Loading />;
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule bg-sheet">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <div>
            <p className="font-semibold">{me.data?.office.name}</p>
            <p className="text-xs text-ink-soft">{me.data?.office.notaryName}</p>
          </div>
          <button onClick={logout} className="text-sm text-ink-soft hover:text-ink">
            Keluar
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-6 px-5 py-8">
        <h1 className="text-xl font-semibold">Halo, {me.data?.fullName}</h1>
        {!matters.data?.length ? (
          <Empty title="Belum ada berkas atas nama Anda">Hubungi kantor notaris bila Anda merasa seharusnya ada berkas di sini.</Empty>
        ) : (
          matters.data.map((m) => <MatterCard key={m.id} m={m} onUploaded={() => matters.refetch()} />)
        )}
        <p className="pt-4 text-center text-xs text-ink-faint">Data Anda dilindungi sesuai UU Pelindungan Data Pribadi. Setiap akses tercatat.</p>
      </main>
    </div>
  );
}

function MatterCard({ m, onUploaded }: { m: PortalMatter; onUploaded: () => void }) {
  const [kind, setKind] = useState('ktp');
  const [file, setFile] = useState<File | null>(null);
  const accepting = !['signed', 'filing', 'done', 'cancelled'].includes(m.status);
  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', file!);
      return api(`/portal/matters/${m.id}/documents`, { form });
    },
    onSuccess: () => {
      setFile(null);
      onUploaded();
    },
  });

  return (
    <article className="rounded-lg border border-rule bg-sheet">
      <div className="border-b border-rule px-5 py-4">
        <p className="text-xs text-ink-faint">
          {m.code} · Anda sebagai {m.role}
        </p>
        <h2 className="mt-0.5 font-semibold">{m.title}</h2>
        <p className="mt-2 text-sm">{m.nextStep}</p>
      </div>
      <div className="px-5 py-4">
        <StatusRail status={m.status} compact />
      </div>

      {m.appointments.length > 0 && (
        <div className="border-t border-rule px-5 py-4 text-sm">
          <p className="font-medium">Jadwal penandatanganan</p>
          {m.appointments.map((a) => (
            <p key={a.id} className="text-ink-soft">
              {waktu(a.startsAt)} WIB{a.room ? `, ${a.room}` : ''}. Bawa KTP asli.
            </p>
          ))}
        </div>
      )}

      {m.invoices.length > 0 && (
        <div className="border-t border-rule px-5 py-4 text-sm">
          <p className="mb-1 font-medium">Tagihan</p>
          {m.invoices.map((i) => (
            <p key={i.id} className="flex justify-between text-ink-soft">
              <span>{i.number}</span>
              <span>
                {rupiah(Number(i.amount) + Number(i.taxEscrow))}{' '}
                <Pill tone={i.status === 'paid' ? 'ok' : 'warn'}>{i.status === 'paid' ? 'Lunas' : i.status === 'partial' ? 'Sebagian' : 'Belum dibayar'}</Pill>
              </span>
            </p>
          ))}
        </div>
      )}

      <div className="border-t border-rule px-5 py-4">
        <p className="mb-2 text-sm font-medium">Dokumen yang Anda kirim</p>
        {m.documents.length === 0 ? (
          <p className="text-sm text-ink-soft">Belum ada.</p>
        ) : (
          <ul className="mb-3 space-y-1 text-sm">
            {m.documents.map((d) => (
              <li key={d.id} className="flex justify-between gap-3">
                <span>{d.kindLabel}</span>
                {d.status === 'ready' ? <Pill tone="ok">Diterima</Pill> : d.status === 'pending_scan' ? <Pill tone="warn">Diperiksa</Pill> : <Pill tone="bad">Ditolak, kirim ulang</Pill>}
              </li>
            ))}
          </ul>
        )}
        {accepting && (
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              upload.mutate();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Jenis dokumen">
                <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {Object.entries(DOCUMENT_KINDS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Foto atau PDF" hint="Maksimal 15 MB">
                <Input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="py-1.5" />
              </Field>
            </div>
            <ErrorBox>{upload.error && errorText(upload.error)}</ErrorBox>
            <Button type="submit" className="w-full sm:w-auto" disabled={!file || upload.isPending}>
              {upload.isPending ? 'Mengirim…' : 'Kirim dokumen'}
            </Button>
          </form>
        )}
      </div>
    </article>
  );
}
