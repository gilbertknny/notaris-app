'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface Me {
  id: string;
  fullName: string;
  email: string;
  role: string;
  permissions: string[];
  mfaEnrolled: boolean;
  mfaVerified: boolean;
  office: { id: string; name: string; notaryName: string; timezone: string };
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), staleTime: 60_000 });
}

/** Tombol dan menu disembunyikan sesuai izin; keputusan akhir tetap di API. */
export function useCan() {
  const { data } = useMe();
  return (perm: string) => !!data?.permissions.includes(perm);
}
