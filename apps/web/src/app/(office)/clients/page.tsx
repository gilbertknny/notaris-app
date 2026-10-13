'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { tanggal } from '@/lib/format';
import { useCan } from '@/lib/session';
import { Button, Empty, Input, Loading, PageHeader, Table, td } from '@/components/ui';

interface ClientRow {
  id: string;
  type: 'person' | 'company';
  fullName: string;
  nikMasked: string | null;
  phone: string | null;
  email: string | null;
  createdAt: string;
}

export default function ClientsPage() {
  const router = useRouter();
  const can = useCan();
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['clients', q], queryFn: () => api<ClientRow[]>(`/clients?q=${encodeURIComponent(q)}`) });

  return (
    <>
      <PageHeader
        title="Klien"
        description="NIK ditampilkan tersamar. Cari dengan NIK lengkap 16 digit untuk menemukan klien tanpa membuka data identitas."
        actions={can('client.write') && <Button onClick={() => router.push('/clients/new')}>Tambah klien</Button>}
      />
      <Input placeholder="Cari nama atau NIK lengkap" value={q} onChange={(e) => setQ(e.target.value)} className="mb-4 max-w-sm" aria-label="Cari klien" />
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty title={q ? 'Klien tidak ditemukan' : 'Belum ada klien'} />
      ) : (
        <Table head={['Nama', 'NIK', 'Kontak', 'Terdaftar']}>
          {data.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-paper" onClick={() => router.push(`/clients/${c.id}`)}>
              <td className={`${td} font-medium`}>
                {c.fullName}
                {c.type === 'company' && <span className="ml-2 text-xs font-normal text-ink-faint">badan usaha</span>}
              </td>
              <td className={`${td} tabular-nums text-ink-soft`}>{c.nikMasked ?? '—'}</td>
              <td className={`${td} text-ink-soft`}>{c.email ?? c.phone ?? '—'}</td>
              <td className={`${td} whitespace-nowrap text-ink-soft`}>{tanggal(c.createdAt)}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
