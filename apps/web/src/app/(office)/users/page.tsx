'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { useMe } from '@/lib/session';
import { Button, ErrorBox, Field, Input, Loading, Modal, PageHeader, Pill, Select, Table, td } from '@/components/ui';

interface User {
  id: string;
  fullName: string;
  email: string;
  active: boolean;
  mfaEnrolled: boolean;
  role: string;
  roleName: string;
}

export default function UsersPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<{ code: string; name: string }[]>('/users/roles') });
  const [form, setForm] = useState({ fullName: '', email: '', roleCode: 'drafter', password: '' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const create = useMutation({
    mutationFn: () => api('/users', { body: form }),
    onSuccess: () => {
      setOpen(false);
      setForm({ fullName: '', email: '', roleCode: 'drafter', password: '' });
      refresh();
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/users/${id}/revoke-sessions`, { method: 'POST' }) });
  const deactivate = useMutation({ mutationFn: (id: string) => api(`/users/${id}/deactivate`, { method: 'POST' }), onSuccess: refresh });

  return (
    <>
      <PageHeader title="Pengguna" description="Akun baru wajib mengaktifkan MFA saat pertama kali masuk." actions={<Button onClick={() => setOpen(true)}>Tambah pengguna</Button>} />
      <ErrorBox>{(revoke.error || deactivate.error) && errorText(revoke.error ?? deactivate.error)}</ErrorBox>
      {revoke.isSuccess && <p className="mb-3 text-sm text-ok">Semua sesi pengguna sudah dicabut.</p>}
      {users.isLoading ? (
        <Loading />
      ) : (
        <Table head={['Nama', 'Peran', 'MFA', 'Status', '']}>
          {users.data?.map((u) => (
            <tr key={u.id}>
              <td className={td}>
                <span className="block font-medium">{u.fullName}</span>
                <span className="text-xs text-ink-faint">{u.email}</span>
              </td>
              <td className={td}>{u.roleName}</td>
              <td className={td}>{u.mfaEnrolled ? <Pill tone="ok">Aktif</Pill> : <Pill tone="warn">Belum</Pill>}</td>
              <td className={td}>{u.active ? 'Aktif' : <Pill tone="bad">Nonaktif</Pill>}</td>
              <td className={`${td} whitespace-nowrap text-right`}>
                {u.active && u.id !== me?.id && (
                  <>
                    <Button variant="quiet" onClick={() => revoke.mutate(u.id)}>
                      Cabut sesi
                    </Button>
                    <Button variant="quiet" className="hover:text-bad" onClick={() => deactivate.mutate(u.id)}>
                      Nonaktifkan
                    </Button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Tambah pengguna">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Nama lengkap">
            <Input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Peran">
            <Select value={form.roleCode} onChange={(e) => setForm({ ...form, roleCode: e.target.value })}>
              {roles.data?.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Kata sandi awal" hint="Minimal 12 karakter. Sampaikan lewat jalur terpisah dari email.">
            <Input type="password" required minLength={12} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <ErrorBox>{create.error && errorText(create.error)}</ErrorBox>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Tambah pengguna
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
