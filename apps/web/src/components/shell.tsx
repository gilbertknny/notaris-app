'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useMe } from '@/lib/session';
import { Loading } from './ui';

const NAV: { href: string; label: string; perm?: string }[] = [
  { href: '/dashboard', label: 'Beranda' },
  { href: '/matters', label: 'Berkas' },
  { href: '/approvals', label: 'Persetujuan', perm: 'draft.approve' },
  { href: '/clients', label: 'Klien', perm: 'client.read' },
  { href: '/calendar', label: 'Jadwal' },
  { href: '/registers', label: 'Buku daftar', perm: 'register.read' },
  { href: '/finance', label: 'Keuangan', perm: 'finance.read' },
  { href: '/reports', label: 'Laporan', perm: 'report.read' },
  { href: '/audit', label: 'Log audit', perm: 'audit.read' },
  { href: '/users', label: 'Pengguna', perm: 'user.manage' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { data: me, isLoading } = useMe();
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);

  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    if (me && !me.mfaVerified) router.replace('/login');
  }, [me, router]);

  if (isLoading || !me) return <Loading />;

  const logout = async () => {
    await api('/auth/logout', { method: 'POST', noRedirect: true }).catch(() => undefined);
    qc.clear();
    router.replace('/login');
  };

  const nav = NAV.filter((n) => !n.perm || me.permissions.includes(n.perm));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <aside className={`${menu ? 'block' : 'hidden'} border-b border-rule bg-ink text-white lg:sticky lg:top-0 lg:block lg:h-dvh lg:border-b-0`}>
        <div className="flex h-full flex-col px-4 py-5">
          <div className="mb-6 px-2">
            <p className="text-[15px] font-semibold leading-snug">{me.office.name}</p>
            <p className="mt-0.5 text-xs text-white/60">{me.office.notaryName}</p>
          </div>
          <nav className="flex-1 space-y-0.5" aria-label="Menu utama">
            {nav.map((n) => {
              const active = pathname === n.href || pathname.startsWith(n.href + '/');
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? 'page' : undefined}
                  className={`block rounded-md px-2.5 py-2 text-sm ${active ? 'bg-white/12 font-medium text-white' : 'text-white/75 hover:bg-white/8 hover:text-white'}`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-6 border-t border-white/15 px-2 pt-4 text-sm">
            <p className="font-medium">{me.fullName}</p>
            <p className="text-xs text-white/60">{me.email}</p>
            <button onClick={logout} className="mt-3 text-xs text-white/75 underline-offset-2 hover:text-white hover:underline">
              Keluar
            </button>
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <div className="flex items-center justify-between border-b border-rule bg-sheet px-4 py-3 lg:hidden">
          <span className="font-semibold">{me.office.name}</span>
          <button onClick={() => setMenu((m) => !m)} aria-expanded={menu} className="rounded-md border border-rule px-3 py-1.5 text-sm">
            Menu
          </button>
        </div>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
