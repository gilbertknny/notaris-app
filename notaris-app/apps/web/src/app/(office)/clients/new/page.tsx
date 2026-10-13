'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { createClientSchema } from '@notaris/shared';
import { api, ApiError, errorText } from '@/lib/api';
import { Button, ErrorBox, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';

export default function NewClientPage() {
  const router = useRouter();
  const [form, setForm] = useState({ type: 'person' as 'person' | 'company', fullName: '', nik: '', npwp: '', birthDate: '', address: '', phone: '', email: '' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/clients', { body: form }),
    onSuccess: (c) => router.push(`/clients/${c.id}`),
  });
  const dupId = create.error instanceof ApiError && create.error.code === 'CLIENT_DUPLICATE' ? (create.error.details as { clientId: string }).clientId : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Validasi yang sama dengan API (skema bersama), agar kesalahan terlihat sebelum dikirim.
    const parsed = createClientSchema.safeParse(form);
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setFieldErrors({});
    create.mutate();
  };

  return (
    <>
      <PageHeader title="Tambah klien" description="NIK, NPWP, dan alamat disimpan terenkripsi. Staf lain hanya melihat versi tersamar." />
      <form onSubmit={submit} className="max-w-2xl space-y-5" noValidate>
        <ErrorBox>
          {create.error && errorText(create.error)}
          {dupId && (
            <>
              {' '}
              <a href={`/clients/${dupId}`} className="underline">
                Buka data klien
              </a>
            </>
          )}
        </ErrorBox>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Jenis">
            <Select value={form.type} onChange={set('type')}>
              <option value="person">Perorangan</option>
              <option value="company">Badan usaha</option>
            </Select>
          </Field>
          <Field label={form.type === 'person' ? 'Nama lengkap sesuai KTP' : 'Nama badan usaha'} error={fieldErrors.fullName}>
            <Input value={form.fullName} onChange={set('fullName')} />
          </Field>
          {form.type === 'person' && (
            <Field label="NIK" error={fieldErrors.nik} hint="16 digit">
              <Input inputMode="numeric" maxLength={16} value={form.nik} onChange={(e) => setForm((f) => ({ ...f, nik: e.target.value.replace(/\D/g, '') }))} />
            </Field>
          )}
          <Field label="NPWP" error={fieldErrors.npwp} hint="Opsional">
            <Input value={form.npwp} onChange={set('npwp')} />
          </Field>
          {form.type === 'person' && (
            <Field label="Tanggal lahir" hint="Opsional">
              <Input type="date" value={form.birthDate} onChange={set('birthDate')} />
            </Field>
          )}
          <Field label="Telepon / WhatsApp">
            <Input inputMode="tel" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Email" error={fieldErrors.email} hint="Dipakai untuk masuk portal klien">
            <Input type="email" value={form.email} onChange={set('email')} />
          </Field>
        </div>
        <Field label="Alamat">
          <Textarea rows={3} value={form.address} onChange={set('address')} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending}>
            Simpan klien
          </Button>
          <Button type="button" variant="quiet" onClick={() => router.back()}>
            Batal
          </Button>
        </div>
      </form>
    </>
  );
}
