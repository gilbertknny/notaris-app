'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { jam } from '@/lib/format';
import { Empty, Loading, PageHeader } from '@/components/ui';

interface Appointment {
  id: string;
  startsAt: string;
  endsAt: string;
  room: string | null;
  note: string | null;
  matterId: string;
  matterCode: string;
  matterTitle: string;
}

const dayKey = (d: string) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const dayLabel = (d: string) => new Date(d).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long' });

export default function CalendarPage() {
  const { data, isLoading } = useQuery({ queryKey: ['appointments'], queryFn: () => api<Appointment[]>('/appointments') });
  const days = new Map<string, Appointment[]>();
  for (const a of data ?? []) days.set(dayKey(a.startsAt), [...(days.get(dayKey(a.startsAt)) ?? []), a]);

  return (
    <>
      <PageHeader title="Jadwal penandatanganan" description="14 hari ke depan. Jadwal dibuat dari tab Jadwal di halaman berkas." />
      {isLoading ? (
        <Loading />
      ) : days.size === 0 ? (
        <Empty title="Belum ada jadwal dalam 14 hari ke depan" />
      ) : (
        <div className="space-y-8">
          {[...days.entries()].map(([key, items]) => (
            <section key={key}>
              <h2 className="mb-2 font-semibold first-letter:uppercase">{dayLabel(items[0].startsAt)}</h2>
              <ul className="divide-y divide-rule rounded-lg border border-rule bg-sheet">
                {items.map((a) => (
                  <li key={a.id}>
                    <Link href={`/matters/${a.matterId}?tab=schedule`} className="flex gap-5 px-4 py-3 hover:bg-paper">
                      <span className="w-28 shrink-0 tabular-nums">
                        <span className="font-semibold">{jam(a.startsAt)}</span>
                        <span className="text-ink-faint"> – {jam(a.endsAt)}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{a.matterTitle}</span>
                        <span className="text-xs text-ink-faint">{a.matterCode}</span>
                      </span>
                      <span className="shrink-0 text-sm text-ink-soft">{a.room}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
