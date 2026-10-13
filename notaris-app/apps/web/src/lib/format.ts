const TZ = 'Asia/Jakarta';

export const rupiah = (v: number | string) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(v));

export const tanggal = (v: string | Date | null | undefined) =>
  v ? new Date(typeof v === 'string' && v.length === 10 ? `${v}T00:00:00+07:00` : v).toLocaleDateString('id-ID', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const waktu = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleString('id-ID', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export const jam = (v: string | Date) => new Date(v).toLocaleTimeString('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

export const ukuran = (bytes: number | string) => {
  const n = Number(bytes);
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
};

/** Bulan berjalan dalam WIB, format YYYY-MM. */
export const bulanIni = () => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${p.find((x) => x.type === 'year')!.value}-${p.find((x) => x.type === 'month')!.value}`;
};

const ACTIONS: Record<string, string> = {
  'matter.created': 'Membuka berkas',
  'matter.assigned': 'Menugaskan staf',
  'matter.unassigned': 'Melepas staf',
  'matters.changed': 'Mengubah data berkas',
  'draft.created': 'Menyusun draf',
  'draft.submitted': 'Mengirim draf ke Notaris',
  'draft.approved': 'Menyetujui draf',
  'draft.returned': 'Mengembalikan draf',
  'draft.downloaded': 'Mengunduh draf',
  'deed.numbered': 'Menandatangani & memberi nomor akta',
  'document.uploaded': 'Mengunggah dokumen',
  'document.link_issued': 'Membuka dokumen',
  'document.downloaded': 'Mengunduh dokumen',
  'document.quarantined': 'Dokumen dikarantina (gagal pemindaian)',
  'invoice.created': 'Membuat tagihan',
  'payment.recorded': 'Mencatat pembayaran',
  'appointment.created': 'Menjadwalkan tanda tangan',
  'appointment.cancelled': 'Membatalkan jadwal',
  'access.denied': 'Akses ditolak',
  'client.revealed': 'Membuka NIK/NPWP lengkap',
  'client.created': 'Menambah klien',
  'login.success': 'Masuk',
  'login.failed': 'Gagal masuk',
  'mfa.reauth': 'Verifikasi MFA ulang',
  'portal.login': 'Klien masuk portal',
  'register.locked': 'Mengunci buku bulanan',
  'register.exported': 'Mengekspor buku daftar',
  'user.created': 'Membuat akun',
  'user.deactivated': 'Menonaktifkan akun',
  'user.sessions_revoked': 'Mencabut sesi',
};
export const aksi = (a: string) => ACTIONS[a] ?? a;
