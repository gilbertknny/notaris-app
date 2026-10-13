import 'reflect-metadata';
import { hash } from '@node-rs/argon2';
import { sql } from 'kysely';
import { authenticator } from 'otplib';
import { DEFAULT_ROLES } from '@notaris/shared';
import { CryptoService } from '../common/crypto.service';
import { createDb } from './connection';
import { SEED_TEMPLATES } from './templates';

export const DEMO_PASSWORD = 'Notaris#2026demo';

export const DEMO_USERS = [
  { email: 'notaris@contoh.id', fullName: 'Dr. Siti Rahmawati, S.H., M.Kn.', role: 'notaris' },
  { email: 'drafter@contoh.id', fullName: 'Andi Pratama', role: 'drafter' },
  { email: 'drafter2@contoh.id', fullName: 'Rina Kusuma', role: 'drafter' },
  { email: 'admin@contoh.id', fullName: 'Dewi Lestari', role: 'admin_kantor' },
  { email: 'keuangan@contoh.id', fullName: 'Budi Santoso', role: 'keuangan' },
  { email: 'sysadmin@contoh.id', fullName: 'Admin Sistem', role: 'admin_sistem' },
];

/**
 * Data demo: satu kantor, enam staf (MFA sudah aktif), template contoh, klien, dan dua berkas.
 * Idempoten: tidak melakukan apa pun bila kantor demo sudah ada.
 */
export async function seed(migratorUrl: string, opts: { officeName?: string; quiet?: boolean } = {}) {
  const db = createDb(migratorUrl, 2);
  const crypto = new CryptoService();
  const officeName = opts.officeName ?? 'Kantor Notaris & PPAT Siti Rahmawati';
  const log = opts.quiet ? () => undefined : console.log;
  try {
    const existing = await db.selectFrom('offices').select('id').where('name', '=', officeName).executeTakeFirst();
    if (existing) {
      log('Data demo sudah ada, seed dilewati.');
      return { officeId: existing.id, secrets: {} as Record<string, string> };
    }
    return await db.transaction().execute(async (trx) => {
      const office = await trx
        .insertInto('offices')
        .values({ name: officeName, notary_name: 'Dr. Siti Rahmawati, S.H., M.Kn.', region_code: 'Kota Jakarta Selatan' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const officeId = office.id;
      await sql`select set_config('app.office_id', ${officeId}, true)`.execute(trx);

      const roleIds: Record<string, string> = {};
      for (const [code, r] of Object.entries(DEFAULT_ROLES)) {
        const row = await trx.insertInto('roles').values({ office_id: officeId, code, name: r.name, permissions: r.permissions }).returning('id').executeTakeFirstOrThrow();
        roleIds[code] = row.id;
      }

      const passwordHash = await hash(DEMO_PASSWORD);
      const secrets: Record<string, string> = {};
      const userIds: Record<string, string> = {};
      const suffix = opts.officeName ? `+${officeId.slice(0, 8)}` : '';
      for (const u of DEMO_USERS) {
        const email = u.email.replace('@', `${suffix}@`);
        const secret = authenticator.generateSecret();
        secrets[email] = secret;
        const row = await trx
          .insertInto('users')
          .values({
            office_id: officeId,
            email,
            full_name: u.fullName,
            password_hash: passwordHash,
            role_id: roleIds[u.role],
            mfa_secret_enc: await crypto.encrypt(trx, officeId, secret),
            mfa_enabled: true,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        userIds[u.role === 'drafter' && userIds.drafter ? 'drafter2' : u.role] = row.id;
      }

      for (const t of SEED_TEMPLATES) {
        await trx.insertInto('templates').values({ office_id: officeId, ...t }).execute();
      }

      const clientSpecs = [
        { type: 'person' as const, full_name: 'Hendra Wijaya', nik: '3174011203800001', email: `klien${suffix}@contoh.id`, phone: '081200000001', address: 'Jl. Kemang Raya No. 10, Jakarta Selatan' },
        { type: 'person' as const, full_name: 'Maria Simanjuntak', nik: '3174024507850002', email: `maria${suffix}@contoh.id`, phone: '081200000002', address: 'Jl. Fatmawati No. 22, Jakarta Selatan' },
        { type: 'person' as const, full_name: 'Agus Salim', nik: '3201010101900003', email: null, phone: '081200000003', address: 'Jl. Margonda No. 5, Depok' },
        { type: 'company' as const, full_name: 'PT Maju Bersama Sejahtera', nik: null, email: `ptmaju${suffix}@contoh.id`, phone: '0217000000', address: 'Jl. Sudirman Kav. 1, Jakarta Pusat' },
      ];
      const clientIds: string[] = [];
      for (const c of clientSpecs) {
        const row = await trx
          .insertInto('clients')
          .values({
            office_id: officeId,
            type: c.type,
            full_name: c.full_name,
            nik_enc: await crypto.encrypt(trx, officeId, c.nik),
            nik_hash: crypto.searchHash(officeId, c.nik),
            npwp_enc: null,
            npwp_hash: null,
            birth_date: null,
            address_enc: await crypto.encrypt(trx, officeId, c.address),
            phone: c.phone,
            email: c.email,
            kyc_risk: 'low',
            archived_at: null,
            created_by: userIds.admin_kantor,
            updated_by: userIds.admin_kantor,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        clientIds.push(row.id);
      }

      const now = new Date();
      const ym = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
      await trx
        .insertInto('matter_code_counters')
        .values({ office_id: officeId, period: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, last_number: 2 })
        .execute();
      const due = new Date(now.getTime() + 5 * 86400_000).toISOString().slice(0, 10);
      const matters = [
        { code: `${ym}/0001`, service_type: 'ajb', title: 'Jual beli rumah Jl. Kemang Raya No. 10', status: 'drafting' as const, owner: userIds.drafter, parties: [[0, 'penjual'], [1, 'pembeli']] as const, due_date: due },
        { code: `${ym}/0002`, service_type: 'pendirian_pt', title: 'Pendirian PT Maju Bersama Sejahtera', status: 'documents' as const, owner: userIds.drafter2, parties: [[1, 'pendiri'], [2, 'pendiri']] as const, due_date: null },
      ];
      for (const m of matters) {
        const row = await trx
          .insertInto('matters')
          .values({ office_id: officeId, code: m.code, service_type: m.service_type, title: m.title, status: m.status, owner_id: m.owner, due_date: m.due_date, created_by: userIds.admin_kantor, updated_by: userIds.admin_kantor })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx.insertInto('matter_assignments').values({ office_id: officeId, matter_id: row.id, user_id: m.owner }).execute();
        for (const [idx, role] of m.parties) {
          await trx.insertInto('matter_parties').values({ office_id: officeId, matter_id: row.id, client_id: clientIds[idx], role }).execute();
        }
      }

      log('\nData demo dibuat. Semua akun memakai kata sandi:', DEMO_PASSWORD);
      log('MFA sudah aktif. Ambil kode 6 digit dengan:  pnpm --filter @notaris/api otp <email>');
      log('atau tambahkan secret berikut ke aplikasi autentikator:');
      for (const [email, secret] of Object.entries(secrets)) log(`  ${email.padEnd(24)} ${secret}`);
      log(`Portal klien: masuk dengan email klien${suffix}@contoh.id (kode OTP muncul di log API saat development).\n`);
      return { officeId, secrets, userIds, clientIds };
    });
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL_MIGRATOR;
  if (!url) {
    console.error('DATABASE_URL_MIGRATOR wajib diisi.');
    process.exit(1);
  }
  seed(url).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
