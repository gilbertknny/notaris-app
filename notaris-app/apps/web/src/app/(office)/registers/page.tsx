'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MONTHS_ID, REGISTER_LABEL, REGISTER_TYPES, RegisterType } from '@notaris/shared';
import { api, errorText } from '@/lib/api';
import { bulanIni, tanggal, waktu } from '@/lib/format';
import { useCan } from '@/lib/session';
import { Button, Empty, ErrorBox, Input, Loading, Modal, Notice, PageHeader, Table, Tabs, td } from '@/components/ui';

interface Register {
  register: RegisterType;
  month: string;
  lastNumber: number;
  lockedAt: string | null;
  lockedBy: string | null;
  entries: { id: string; number: number; signedAt: string; title: string; matterId: string; matterCode: string; parties: string | null }[];
}

export default function RegistersPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [type, setType] = useState<RegisterType>('repertorium');
  const [month, setMonth] = useState(bulanIni());
  const [lockOpen, setLockOpen] = useState(false);
  const key = ['register', type, month];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api<Register>(`/registers/${type}?month=${month}`) });
  const lock = useMutation({
    mutationFn: () => api(`/registers/${type}/${month}/lock`, { method: 'POST' }),
    onSuccess: () => {
      setLockOpen(false);
      qc.invalidateQueries({ queryKey: key });
    },
  });
  const [y, m] = month.split('-').map(Number);
  const label = `${MONTHS_ID[m - 1]} ${y}`;

  return (
    <>
      <PageHeader
        title="Buku daftar"
        description="Terisi otomatis setiap kali akta diberi nomor. Kunci bulan setelah laporan dikirim ke Majelis Pengawas."
        actions={
          <>
            <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Bulan" className="w-44" />
            <a href={`/api/v1/registers/${type}/export?month=${month}`} className="inline-flex h-9 items-center rounded-md border border-rule bg-sheet px-3.5 text-sm font-medium hover:border-ink-faint">
              Ekspor CSV
            </a>
            {can('register.lock') && !data?.lockedAt && (
              <Button variant="secondary" onClick={() => setLockOpen(true)}>
                Kunci {label}
              </Button>
            )}
          </>
        }
      />
      <Tabs<RegisterType> value={type} onChange={setType} items={REGISTER_TYPES.map((r) => ({ id: r, label: REGISTER_LABEL[r] }))} />
      <ErrorBox>{error && errorText(error)}</ErrorBox>
      {data?.lockedAt && (
        <div className="mb-4">
          <Notice>
            {REGISTER_LABEL[type]} {label} dikunci {waktu(data.lockedAt)} oleh {data.lockedBy}. Tidak ada nomor baru yang bisa dipakai di bulan ini.
          </Notice>
        </div>
      )}
      {isLoading ? (
        <Loading />
      ) : !data?.entries.length ? (
        <Empty title={`${REGISTER_LABEL[type]} ${label} masih kosong`}>Akta yang ditandatangani dan diberi nomor di bulan ini akan tercatat di sini.</Empty>
      ) : (
        <Table head={['No. urut', 'Nomor akta', 'Tanggal', 'Sifat akta', 'Nama penghadap', 'Berkas']}>
          {data.entries.map((e, i) => (
            <tr key={e.id}>
              <td className={`${td} tabular-nums text-ink-soft`}>{i + 1}</td>
              <td className={`${td} font-semibold tabular-nums`}>{e.number}</td>
              <td className={`${td} whitespace-nowrap`}>{tanggal(e.signedAt)}</td>
              <td className={td}>{e.title}</td>
              <td className={td}>{e.parties ?? '—'}</td>
              <td className={`${td} tabular-nums`}>
                <Link href={`/matters/${e.matterId}`} className="hover:text-stamp">
                  {e.matterCode}
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal open={lockOpen} onClose={() => setLockOpen(false)} title={`Kunci ${REGISTER_LABEL[type]} ${label}?`}>
        <p className="mb-4 text-sm text-ink-soft">
          Lakukan setelah salinan buku daftar bulan ini dikirim. Setelah dikunci, akta baru dengan tanggal di bulan ini tidak bisa diberi nomor. Koreksi hanya lewat entri koreksi oleh Notaris.
        </p>
        <ErrorBox>{lock.error && errorText(lock.error)}</ErrorBox>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setLockOpen(false)}>
            Batal
          </Button>
          <Button onClick={() => lock.mutate()} disabled={lock.isPending}>
            Kunci bulan
          </Button>
        </div>
      </Modal>
    </>
  );
}
