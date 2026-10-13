'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { waktu } from '@/lib/format';
import { Empty, Loading, PageHeader, Table, td } from '@/components/ui';

interface Approval {
  id: string;
  version: number;
  submittedAt: string;
  matterId: string;
  code: string;
  title: string;
  templateName: string;
  drafterName: string | null;
}

export default function ApprovalsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['approvals'], queryFn: () => api<Approval[]>('/approvals') });
  return (
    <>
      <PageHeader title="Persetujuan draf" description="Draf yang dikirim staf, terlama di atas. Menyetujui draf meminta kode MFA." />
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty title="Tidak ada draf yang menunggu">Draf baru dari staf akan muncul di sini.</Empty>
      ) : (
        <Table head={['Berkas', 'Draf', 'Penyusun', 'Dikirim', '']}>
          {data.map((a) => (
            <tr key={a.id}>
              <td className={td}>
                <span className="block font-medium">{a.title}</span>
                <span className="text-xs text-ink-faint">{a.code}</span>
              </td>
              <td className={td}>
                {a.templateName} <span className="text-ink-faint">v{a.version}</span>
              </td>
              <td className={`${td} text-ink-soft`}>{a.drafterName ?? '—'}</td>
              <td className={`${td} whitespace-nowrap text-ink-soft`}>{waktu(a.submittedAt)}</td>
              <td className={`${td} text-right`}>
                <Link href={`/drafts/${a.id}`} className="font-medium text-stamp hover:underline">
                  Periksa
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
