'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MatterStatus } from '@notaris/shared';
import { api, errorText } from '@/lib/api';
import { useCan } from '@/lib/session';
import { Button, Empty, ErrorBox, Loading, PageHeader, Pill, StatusBadge, Table, td } from '@/components/ui';

interface Client {
  id: string;
  type: 'person' | 'company';
  fullName: string;
  nikMasked: string | null;
  npwpMasked: string | null;
  phone: string | null;
  email: string | null;
  kycRisk: string | null;
  birthDate: string | null;
  hasAddress: boolean;
  matters: { id: string; code: string; title: string; status: MatterStatus; role: string }[];
}

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const { data: c, isLoading, error } = useQuery({ queryKey: ['client', id], queryFn: () => api<Client>(`/clients/${id}`) });
  const reveal = useMutation({ mutationFn: () => api<{ nik: string | null; npwp: string | null; address: string | null }>(`/clients/${id}/reveal`, { method: 'POST' }) });

  if (error) return <ErrorBox>{errorText(error)}</ErrorBox>;
  if (isLoading || !c) return <Loading />;
  const r = reveal.data;

  return (
    <>
      <PageHeader
        title={c.fullName}
        description={c.type === 'company' ? 'Badan usaha' : 'Perorangan'}
        actions={
          can('client.reveal') &&
          !r && (
            <Button variant="secondary" onClick={() => reveal.mutate()} disabled={reveal.isPending}>
              Tampilkan data identitas
            </Button>
          )
        }
      />
      <ErrorBox>{reveal.error && errorText(reveal.error)}</ErrorBox>
      <dl className="mb-8 grid gap-x-8 gap-y-4 rounded-lg border border-rule bg-sheet p-5 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-ink-soft">NIK</dt>
          <dd className="mt-0.5 tabular-nums">{r?.nik ?? c.nikMasked ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-ink-soft">NPWP</dt>
          <dd className="mt-0.5 tabular-nums">{r?.npwp ?? c.npwpMasked ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-ink-soft">Risiko PMPJ</dt>
          <dd className="mt-0.5">
            <Pill tone={c.kycRisk === 'high' ? 'bad' : c.kycRisk === 'medium' ? 'warn' : 'ok'}>{{ low: 'Rendah', medium: 'Sedang', high: 'Tinggi' }[c.kycRisk ?? 'low']}</Pill>
          </dd>
        </div>
        <div>
          <dt className="text-ink-soft">Telepon</dt>
          <dd className="mt-0.5">{c.phone ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-ink-soft">Email</dt>
          <dd className="mt-0.5">{c.email ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-ink-soft">Alamat</dt>
          <dd className="mt-0.5">{r?.address ?? (c.hasAddress ? 'Tersimpan (tersembunyi)' : '—')}</dd>
        </div>
      </dl>
      {r && <p className="-mt-6 mb-8 text-xs text-ink-faint">Pembukaan data ini tercatat di log audit atas nama Anda.</p>}

      <h2 className="mb-3 font-semibold">Berkas</h2>
      {c.matters.length === 0 ? (
        <Empty title="Klien ini belum terkait berkas" />
      ) : (
        <Table head={['Nomor', 'Berkas', 'Peran', 'Status']}>
          {c.matters.map((m) => (
            <tr key={`${m.id}-${m.role}`}>
              <td className={`${td} tabular-nums`}>
                <Link href={`/matters/${m.id}`} className="font-medium hover:text-stamp">
                  {m.code}
                </Link>
              </td>
              <td className={td}>{m.title}</td>
              <td className={`${td} text-ink-soft`}>{m.role}</td>
              <td className={td}>
                <StatusBadge status={m.status} />
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
