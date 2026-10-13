'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { aksi, waktu } from '@/lib/format';
import { Empty, Loading, PageHeader, Pill, Select, Table, td } from '@/components/ui';

interface Log {
  id: string;
  at: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorType: string;
  actorName: string | null;
  ip: string | null;
  detail: Record<string, unknown> | null;
}

const FILTERS = [
  ['', 'Semua aktivitas'],
  ['access.denied', 'Akses ditolak'],
  ['client.revealed', 'Pembukaan NIK/NPWP'],
  ['document.', 'Dokumen'],
  ['login', 'Login'],
  ['deed.', 'Penomoran akta'],
  ['register.', 'Buku daftar'],
  ['user.', 'Akun pengguna'],
] as const;

export default function AuditPage() {
  const [action, setAction] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['audit', action], queryFn: () => api<Log[]>(`/audit-logs?limit=200${action ? `&action=${action}` : ''}`) });
  return (
    <>
      <PageHeader title="Log audit" description="Catatan tidak bisa diubah atau dihapus, termasuk oleh admin. Menampilkan 200 entri terbaru." />
      <Select value={action} onChange={(e) => setAction(e.target.value)} className="mb-4 max-w-xs" aria-label="Filter aktivitas">
        {FILTERS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty title="Belum ada catatan untuk filter ini" />
      ) : (
        <Table head={['Waktu', 'Pelaku', 'Aktivitas', 'Objek', 'IP']}>
          {data.map((l) => (
            <tr key={l.id}>
              <td className={`${td} whitespace-nowrap tabular-nums text-ink-soft`}>{waktu(l.at)}</td>
              <td className={td}>{l.actorName ?? (l.actorType === 'client' ? 'Klien' : 'Sistem')}</td>
              <td className={td}>{l.action === 'access.denied' ? <Pill tone="bad">{aksi(l.action)}</Pill> : aksi(l.action)}</td>
              <td className={`${td} text-xs text-ink-soft`}>
                {l.entity}
                {l.entityId && <span className="block max-w-[220px] truncate font-normal">{l.entityId}</span>}
              </td>
              <td className={`${td} tabular-nums text-xs text-ink-soft`}>{l.ip ?? '—'}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
