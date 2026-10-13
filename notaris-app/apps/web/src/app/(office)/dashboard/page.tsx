'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { DOCUMENT_KINDS, MATTER_STATUS_LABEL, MatterStatus } from '@notaris/shared';
import { api } from '@/lib/api';
import { jam, tanggal, waktu } from '@/lib/format';
import { useMe } from '@/lib/session';
import { Empty, Loading, PageHeader, StatusBadge } from '@/components/ui';

interface Dashboard {
  byStatus: { status: MatterStatus; count: number }[];
  dueSoon: { id: string; code: string; title: string; status: MatterStatus; dueDate: string }[];
  today: { id: string; startsAt: string; room: string | null; matterId: string; code: string; title: string }[];
  pendingApprovals: number | null;
  newClientDocuments: { id: string; kind: string; filename: string; status: string; createdAt: string; matterId: string; code: string }[];
}

const ORDER: MatterStatus[] = ['intake', 'documents', 'drafting', 'review', 'scheduled', 'signed', 'filing'];

export default function DashboardPage() {
  const { data: me } = useMe();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard') });
  if (isLoading || !data) return <Loading />;

  const count = (s: MatterStatus) => data.byStatus.find((b) => b.status === s)?.count ?? 0;
  const active = ORDER.reduce((n, s) => n + count(s), 0);

  return (
    <>
      <PageHeader title={`Selamat bekerja, ${me?.fullName.split(' ')[0] ?? ''}`} description={`${active} berkas berjalan${me?.permissions.includes('matter.read_all') ? ' di kantor' : ' ditugaskan kepada Anda'}.`} />

      {data.pendingApprovals ? (
        <Link href="/approvals" className="mb-6 flex items-center justify-between rounded-lg border border-stamp/30 bg-stamp-soft px-5 py-4 hover:border-stamp">
          <span>
            <span className="font-semibold text-stamp">{data.pendingApprovals} draf</span> menunggu persetujuan Anda
          </span>
          <span className="text-sm font-medium text-stamp">Buka antrean</span>
        </Link>
      ) : null}

      <section aria-label="Berkas per tahap" className="mb-8 overflow-x-auto">
        <ol className="flex min-w-max border-y border-rule">
          {ORDER.map((s) => (
            <li key={s} className="flex-1 border-r border-rule last:border-r-0">
              <Link href={`/matters?status=${s}`} className="block px-4 py-3 hover:bg-sheet">
                <span className="block text-2xl font-semibold tabular-nums">{count(s)}</span>
                <span className="text-sm text-ink-soft">{MATTER_STATUS_LABEL[s]}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 font-semibold">Tenggat 7 hari ke depan</h2>
          {data.dueSoon.length === 0 ? (
            <Empty title="Tidak ada tenggat dekat" />
          ) : (
            <ul className="divide-y divide-rule rounded-lg border border-rule bg-sheet">
              {data.dueSoon.map((m) => (
                <li key={m.id}>
                  <Link href={`/matters/${m.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-paper">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{m.title}</span>
                      <span className="text-xs text-ink-faint">{m.code}</span>
                    </span>
                    <span className="shrink-0 text-right text-sm">
                      <span className="block">{tanggal(m.dueDate)}</span>
                      <StatusBadge status={m.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 font-semibold">Jadwal hari ini</h2>
          {data.today.length === 0 ? (
            <Empty title="Tidak ada penandatanganan hari ini">
              <Link href="/calendar" className="text-stamp underline underline-offset-2">Lihat jadwal minggu ini</Link>
            </Empty>
          ) : (
            <ul className="divide-y divide-rule rounded-lg border border-rule bg-sheet">
              {data.today.map((a) => (
                <li key={a.id}>
                  <Link href={`/matters/${a.matterId}`} className="flex gap-4 px-4 py-3 hover:bg-paper">
                    <span className="w-12 shrink-0 font-semibold tabular-nums">{jam(a.startsAt)}</span>
                    <span className="min-w-0">
                      <span className="block truncate">{a.title}</span>
                      <span className="text-xs text-ink-faint">{a.code}{a.room ? `, ruang ${a.room}` : ''}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">Dokumen baru dari klien</h2>
          {data.newClientDocuments.length === 0 ? (
            <Empty title="Belum ada unggahan baru minggu ini" />
          ) : (
            <ul className="divide-y divide-rule rounded-lg border border-rule bg-sheet">
              {data.newClientDocuments.map((d) => (
                <li key={d.id}>
                  <Link href={`/matters/${d.matterId}?tab=documents`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-paper">
                    <span>
                      {DOCUMENT_KINDS[d.kind as keyof typeof DOCUMENT_KINDS] ?? d.kind} <span className="text-ink-faint">· {d.code}</span>
                    </span>
                    <span className="text-sm text-ink-soft">{waktu(d.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
