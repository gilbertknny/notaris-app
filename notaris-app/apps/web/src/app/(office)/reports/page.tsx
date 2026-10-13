'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MONTHS_ID, REGISTER_LABEL, RegisterType } from '@notaris/shared';
import { api } from '@/lib/api';
import { bulanIni, rupiah } from '@/lib/format';
import { Input, Loading, PageHeader, Table, td } from '@/components/ui';

interface Monthly {
  month: string;
  deedsByRegister: { register: RegisterType; count: number; lastNumber: number }[];
  mattersOpened: number;
  mattersDone: number;
  invoicedTotal: number;
  paidTotal: number;
}

export default function ReportsPage() {
  const [month, setMonth] = useState(bulanIni());
  const { data, isLoading } = useQuery({ queryKey: ['monthly', month], queryFn: () => api<Monthly>(`/reports/monthly?month=${month}`) });
  const [y, m] = month.split('-').map(Number);

  return (
    <>
      <PageHeader
        title={`Laporan ${MONTHS_ID[m - 1]} ${y}`}
        description="Rekap untuk laporan bulanan. Daftar akta lengkap per buku diekspor dari halaman Buku daftar."
        actions={<Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Bulan" className="w-44" />}
      />
      {isLoading || !data ? (
        <Loading />
      ) : (
        <div className="space-y-8">
          <dl className="grid gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-4">
            {[
              ['Berkas dibuka', String(data.mattersOpened)],
              ['Berkas selesai', String(data.mattersDone)],
              ['Ditagihkan', rupiah(data.invoicedTotal)],
              ['Diterima', rupiah(data.paidTotal)],
            ].map(([k, v]) => (
              <div key={k} className="bg-sheet px-5 py-4">
                <dt className="text-sm text-ink-soft">{k}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <section>
            <h2 className="mb-3 font-semibold">Akta per buku daftar</h2>
            <Table head={['Buku', 'Jumlah akta', 'Nomor terakhir']}>
              {(['repertorium', 'ppat', 'legalisasi', 'waarmerking'] as RegisterType[]).map((r) => {
                const row = data.deedsByRegister.find((d) => d.register === r);
                return (
                  <tr key={r}>
                    <td className={td}>{REGISTER_LABEL[r]}</td>
                    <td className={`${td} tabular-nums`}>{row?.count ?? 0}</td>
                    <td className={`${td} tabular-nums`}>{row?.lastNumber ?? '—'}</td>
                  </tr>
                );
              })}
            </Table>
          </section>
        </div>
      )}
    </>
  );
}
