'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MATTER_STATUS_LABEL, MATTER_STATUSES, MatterStatus, SERVICE_TYPES } from '@notaris/shared';
import { api } from '@/lib/api';
import { tanggal } from '@/lib/format';
import { useCan } from '@/lib/session';
import { Button, Empty, Input, Loading, PageHeader, Select, StatusBadge, Table, td } from '@/components/ui';

interface MatterRow {
  id: string;
  code: string;
  title: string;
  serviceType: keyof typeof SERVICE_TYPES;
  status: MatterStatus;
  dueDate: string | null;
  isSensitive: boolean;
  ownerName: string;
  parties: string | null;
}

function MattersList() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [q, setQ] = useState('');
  const query = new URLSearchParams({ ...(status && { status }), ...(q && { q }) }).toString();
  const { data, isLoading } = useQuery({ queryKey: ['matters', query], queryFn: () => api<MatterRow[]>(`/matters?${query}`) });

  return (
    <>
      <PageHeader
        title="Berkas"
        description={can('matter.read_all') ? 'Semua berkas kantor.' : 'Berkas yang ditugaskan kepada Anda.'}
        actions={can('matter.create') && <Button onClick={() => router.push('/matters/new')}>Buka berkas baru</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input placeholder="Cari nomor berkas, judul, atau nama pihak" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" aria-label="Cari berkas" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[200px]" aria-label="Filter status">
          <option value="">Semua status</option>
          {MATTER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {MATTER_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty title={q || status ? 'Tidak ada berkas yang cocok' : 'Belum ada berkas'}>{q || status ? 'Ubah kata kunci atau filter status.' : 'Berkas yang dibuka akan tampil di sini.'}</Empty>
      ) : (
        <Table head={['Nomor', 'Berkas', 'Layanan', 'Status', 'Tenggat', 'Penanggung jawab']}>
          {data.map((m) => (
            <tr key={m.id} className="cursor-pointer hover:bg-paper" onClick={() => router.push(`/matters/${m.id}`)}>
              <td className={`${td} whitespace-nowrap tabular-nums`}>
                <Link href={`/matters/${m.id}`} className="font-medium hover:text-stamp" onClick={(e) => e.stopPropagation()}>
                  {m.code}
                </Link>
              </td>
              <td className={td}>
                <span className="block font-medium">{m.title}</span>
                <span className="text-xs text-ink-soft">{m.parties}</span>
                {m.isSensitive && <span className="ml-2 text-xs text-bad">Sensitif</span>}
              </td>
              <td className={`${td} text-ink-soft`}>{SERVICE_TYPES[m.serviceType] ?? m.serviceType}</td>
              <td className={td}>
                <StatusBadge status={m.status} />
              </td>
              <td className={`${td} whitespace-nowrap`}>{tanggal(m.dueDate)}</td>
              <td className={`${td} text-ink-soft`}>{m.ownerName}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

export default function MattersPage() {
  return (
    <Suspense>
      <MattersList />
    </Suspense>
  );
}
