'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { SERVICE_TYPES } from '@notaris/shared';
import { api, errorText } from '@/lib/api';
import { Button, ErrorBox, Field, Input, PageHeader, Select } from '@/components/ui';

interface ClientRow {
  id: string;
  fullName: string;
  type: string;
  nikMasked: string | null;
}

const ROLE_HINTS: Record<string, string[]> = {
  ajb: ['penjual', 'pembeli'],
  apht: ['pemberi hak tanggungan', 'penerima hak tanggungan'],
  hibah: ['pemberi hibah', 'penerima hibah'],
  kuasa: ['pemberi kuasa', 'penerima kuasa'],
  pendirian_pt: ['pendiri'],
  waris: ['ahli waris'],
};

export default function NewMatterPage() {
  const router = useRouter();
  const [serviceType, setServiceType] = useState<keyof typeof SERVICE_TYPES>('ajb');
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [q, setQ] = useState('');
  const [parties, setParties] = useState<{ client: ClientRow; role: string }[]>([]);
  const roles = ROLE_HINTS[serviceType] ?? ['penghadap'];

  const { data: results } = useQuery({
    queryKey: ['clients', q],
    queryFn: () => api<ClientRow[]>(`/clients?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/matters', {
        body: { serviceType, title, dueDate, parties: parties.map((p) => ({ clientId: p.client.id, role: p.role })) },
      }),
    onSuccess: (m) => router.push(`/matters/${m.id}`),
  });

  return (
    <>
      <PageHeader title="Buka berkas baru" description="Nomor berkas dibuat otomatis. Anda menjadi penanggung jawab dan bisa menugaskan staf lain sesudahnya." />
      <form
        className="max-w-2xl space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <ErrorBox>{create.error && errorText(create.error)}</ErrorBox>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Jenis layanan">
            <Select value={serviceType} onChange={(e) => setServiceType(e.target.value as keyof typeof SERVICE_TYPES)}>
              {Object.entries(SERVICE_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tenggat" hint="Opsional">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Judul berkas" hint="Contoh: Jual beli rumah Jl. Kemang Raya No. 10">
          <Input required minLength={3} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Pihak</legend>
          {parties.length > 0 && (
            <ul className="mb-3 divide-y divide-rule rounded-lg border border-rule bg-sheet">
              {parties.map((p, i) => (
                <li key={`${p.client.id}-${i}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{p.client.fullName}</span>
                    <span className="text-xs text-ink-faint">{p.client.nikMasked ?? 'Badan usaha'}</span>
                  </span>
                  <Select
                    aria-label={`Peran ${p.client.fullName}`}
                    value={p.role}
                    onChange={(e) => setParties((ps) => ps.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}
                    className="w-auto"
                  >
                    {[...new Set([...roles, 'kuasa', 'saksi', 'penghadap'])].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </Select>
                  <Button type="button" variant="quiet" onClick={() => setParties((ps) => ps.filter((_, j) => j !== i))}>
                    Hapus
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Input placeholder="Cari klien berdasarkan nama atau NIK lengkap" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari klien" />
          {q.trim().length >= 2 && (
            <ul className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-rule bg-sheet">
              {results?.length ? (
                results.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="flex w-full justify-between px-4 py-2 text-left text-sm hover:bg-paper"
                      onClick={() => {
                        setParties((ps) => [...ps, { client: c, role: roles[Math.min(ps.length, roles.length - 1)] }]);
                        setQ('');
                      }}
                    >
                      <span>{c.fullName}</span>
                      <span className="text-ink-faint">{c.nikMasked ?? 'Badan usaha'}</span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-4 py-3 text-sm text-ink-soft">
                  Klien tidak ditemukan.{' '}
                  <Link href="/clients/new" target="_blank" className="text-stamp underline underline-offset-2">
                    Tambah klien baru
                  </Link>
                </li>
              )}
            </ul>
          )}
        </fieldset>

        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending || parties.length === 0 || title.trim().length < 3}>
            Buka berkas
          </Button>
          <Button type="button" variant="quiet" onClick={() => router.back()}>
            Batal
          </Button>
        </div>
      </form>
    </>
  );
}
