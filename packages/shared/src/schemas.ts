import { z } from 'zod';
import { DOCUMENT_KINDS, MATTER_STATUSES, REGISTER_TYPES, SERVICE_TYPES } from './domain';

const serviceTypes = Object.keys(SERVICE_TYPES) as [string, ...string[]];
const documentKinds = Object.keys(DOCUMENT_KINDS) as [string, ...string[]];

export const nikSchema = z
  .string()
  .regex(/^\d{16}$/, 'NIK harus 16 digit angka');

export const npwpSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v.length === 15 || v.length === 16, 'NPWP harus 15 atau 16 digit');

export const loginSchema = z.object({
  email: z.string().email('Email tidak valid').toLowerCase(),
  password: z.string().min(1, 'Kata sandi wajib diisi'),
});

export const mfaCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Kode harus 6 digit'),
});

export const createClientSchema = z
  .object({
    type: z.enum(['person', 'company']),
    fullName: z.string().trim().min(2, 'Nama minimal 2 karakter').max(200),
    nik: nikSchema.optional().or(z.literal('').transform(() => undefined)),
    npwp: npwpSchema.optional().or(z.literal('').transform(() => undefined)),
    birthDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    address: z.string().max(500).optional(),
    phone: z.string().max(30).optional(),
    email: z.string().email('Email tidak valid').optional().or(z.literal('').transform(() => undefined)),
  })
  .refine((v) => v.type === 'company' || !!v.nik, {
    message: 'NIK wajib untuk klien perorangan',
    path: ['nik'],
  });
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const createMatterSchema = z.object({
  serviceType: z.enum(serviceTypes),
  title: z.string().trim().min(3).max(200),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  parties: z
    .array(z.object({ clientId: z.string().uuid(), role: z.string().trim().min(2).max(50) }))
    .min(1, 'Minimal satu pihak'),
});
export type CreateMatterInput = z.infer<typeof createMatterSchema>;

export const transitionSchema = z.object({
  to: z.enum(MATTER_STATUSES),
  note: z.string().max(500).optional(),
});

export const assignSchema = z.object({ userId: z.string().uuid() });

export const createDraftSchema = z.object({ templateId: z.string().uuid() });
export const updateDraftSchema = z.object({ content: z.string().min(1).max(200_000) });
export const returnDraftSchema = z.object({ note: z.string().trim().min(3).max(1000) });

export const numberDeedSchema = z.object({
  register: z.enum(REGISTER_TYPES),
  title: z.string().trim().min(3).max(300),
  signedAt: z.string().datetime({ offset: true }).optional(),
});

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Format bulan YYYY-MM');

export const createInvoiceSchema = z.object({
  matterId: z.string().uuid(),
  amount: z.coerce.number().positive().max(1e12),
  taxEscrow: z.coerce.number().min(0).max(1e12).default(0),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().max(300).optional(),
});

export const createPaymentSchema = z.object({
  amount: z.coerce.number().positive().max(1e12),
  method: z.enum(['transfer', 'tunai', 'va', 'qris']),
  reference: z.string().max(100).optional(),
});

export const createAppointmentSchema = z.object({
  matterId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  room: z.string().max(50).optional(),
  note: z.string().max(300).optional(),
});

export const uploadDocumentSchema = z.object({
  kind: z.enum(documentKinds),
  clientId: z.string().uuid().optional(),
});

export const portalOtpRequestSchema = z.object({ email: z.string().email().toLowerCase() });
export const portalOtpVerifySchema = z.object({
  email: z.string().email().toLowerCase(),
  code: z.string().regex(/^\d{6}$/),
});

export const createUserSchema = z.object({
  email: z.string().email().toLowerCase(),
  fullName: z.string().trim().min(2).max(200),
  roleCode: z.string().min(2),
  password: z.string().min(12, 'Kata sandi minimal 12 karakter'),
});
