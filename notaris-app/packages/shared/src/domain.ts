/**
 * Aturan domain yang dipakai bersama oleh API dan frontend.
 * Lihat tab "Diagram UML" (state diagram) dan "Security" (matriks hak akses) di project plan.
 */

export const MATTER_STATUSES = [
  'intake',
  'documents',
  'drafting',
  'review',
  'scheduled',
  'signed',
  'filing',
  'done',
  'cancelled',
] as const;
export type MatterStatus = (typeof MATTER_STATUSES)[number];

export const MATTER_STATUS_LABEL: Record<MatterStatus, string> = {
  intake: 'Penerimaan',
  documents: 'Dokumen',
  drafting: 'Penyusunan',
  review: 'Review',
  scheduled: 'Terjadwal',
  signed: 'Ditandatangani',
  filing: 'Pendaftaran',
  done: 'Selesai',
  cancelled: 'Dibatalkan',
};

/** Transisi yang diizinkan. Status lain tidak bisa dilompati. */
export const MATTER_TRANSITIONS: Record<MatterStatus, readonly MatterStatus[]> = {
  intake: ['documents', 'cancelled'],
  documents: ['drafting', 'cancelled'],
  drafting: ['review', 'cancelled'],
  review: ['drafting', 'scheduled', 'cancelled'],
  scheduled: ['signed', 'cancelled'],
  signed: ['filing'],
  filing: ['done'],
  done: [],
  cancelled: [],
};

/**
 * Transisi yang hanya boleh terjadi lewat aksi khusus (bukan endpoint transisi manual):
 * review/scheduled diatur modul draf, signed diatur modul penomoran akta.
 */
export const SYSTEM_ONLY_TRANSITIONS: ReadonlyArray<[MatterStatus, MatterStatus]> = [
  ['drafting', 'review'],
  ['review', 'drafting'],
  ['review', 'scheduled'],
  ['scheduled', 'signed'],
];

export function canTransition(from: MatterStatus, to: MatterStatus): boolean {
  return MATTER_TRANSITIONS[from].includes(to);
}

export function isManualTransition(from: MatterStatus, to: MatterStatus): boolean {
  return (
    canTransition(from, to) &&
    !SYSTEM_ONLY_TRANSITIONS.some(([f, t]) => f === from && t === to)
  );
}

export const REGISTER_TYPES = ['repertorium', 'legalisasi', 'waarmerking', 'ppat'] as const;
export type RegisterType = (typeof REGISTER_TYPES)[number];
export const REGISTER_LABEL: Record<RegisterType, string> = {
  repertorium: 'Repertorium',
  legalisasi: 'Legalisasi',
  waarmerking: 'Waarmerking',
  ppat: 'Akta PPAT',
};

export const DRAFT_STATUSES = ['draft', 'submitted', 'approved', 'returned'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];
export const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = {
  draft: 'Draf',
  submitted: 'Menunggu persetujuan',
  approved: 'Disetujui',
  returned: 'Dikembalikan',
};

export const SERVICE_TYPES = {
  pendirian_pt: 'Pendirian PT',
  perubahan_pt: 'Perubahan anggaran dasar PT',
  pendirian_cv: 'Pendirian CV',
  yayasan: 'Pendirian yayasan',
  ajb: 'Akta jual beli (AJB)',
  apht: 'Akta pemberian hak tanggungan (APHT)',
  hibah: 'Hibah',
  fidusia: 'Jaminan fidusia',
  waris: 'Keterangan waris',
  wasiat: 'Wasiat',
  kuasa: 'Kuasa',
  legalisasi: 'Legalisasi',
  waarmerking: 'Waarmerking',
} as const;
export type ServiceType = keyof typeof SERVICE_TYPES;

/** Layanan yang otomatis ditandai sensitif (akses dibatasi). */
export const SENSITIVE_SERVICES: readonly ServiceType[] = ['wasiat', 'waris'];

export const PERMISSIONS = [
  'matter.read_all',
  'matter.create',
  'matter.assign',
  'matter.transition',
  'client.read',
  'client.write',
  'client.reveal',
  'document.write',
  'draft.write',
  'draft.approve',
  'deed.number',
  'register.read',
  'register.lock',
  'finance.read',
  'finance.write',
  'schedule.write',
  'report.read',
  'user.manage',
  'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Peran bawaan, sesuai matriks hak akses di tab Security. */
export const DEFAULT_ROLES: Record<string, { name: string; permissions: Permission[] }> = {
  notaris: { name: 'Notaris/PPAT', permissions: [...PERMISSIONS] },
  drafter: {
    name: 'Staf akta (drafter)',
    permissions: [
      'matter.create',
      'matter.transition',
      'client.read',
      'client.write',
      'client.reveal',
      'document.write',
      'draft.write',
      'register.read',
      'finance.read',
      'schedule.write',
    ],
  },
  admin_kantor: {
    name: 'Staf administrasi',
    permissions: [
      'matter.create',
      'matter.transition',
      'client.read',
      'client.write',
      'client.reveal',
      'document.write',
      'register.read',
      'finance.read',
      'schedule.write',
      'report.read',
    ],
  },
  keuangan: {
    name: 'Staf keuangan',
    permissions: ['client.read', 'finance.read', 'finance.write', 'report.read'],
  },
  admin_sistem: {
    name: 'Admin sistem',
    permissions: ['user.manage', 'audit.read'],
  },
};

/** Izin yang hanya boleh dimiliki peran Notaris (tidak bisa diberikan ke peran lain). */
export const NOTARY_ONLY: readonly Permission[] = ['draft.approve', 'deed.number', 'register.lock'];

export const DOCUMENT_KINDS = {
  ktp: 'KTP',
  npwp: 'NPWP',
  kk: 'Kartu Keluarga',
  sertifikat: 'Sertifikat tanah',
  pbb: 'SPPT PBB',
  akta_pendirian: 'Akta pendirian',
  bukti_pajak: 'Bukti setor pajak',
  lainnya: 'Lainnya',
} as const;
export type DocumentKind = keyof typeof DOCUMENT_KINDS;

/** Samarkan NIK/NPWP: 3171********0001 */
export function maskId(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 8) return '*'.repeat(digits.length);
  return digits.slice(0, 4) + '*'.repeat(digits.length - 8) + digits.slice(-4);
}

/** Format nomor akta: "Nomor 12" dan periode "Oktober 2026". */
export const MONTHS_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];
