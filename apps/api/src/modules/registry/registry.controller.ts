import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sql } from 'kysely';
import { monthSchema, numberDeedSchema, REGISTER_TYPES, RegisterType } from '@notaris/shared';
import { Auth, AuthContext, Can, RecentMfa } from '../../common/auth/auth-context';
import { DbService, emit, Trx, writeAudit } from '../../common/db.service';
import { AppError } from '../../common/errors';
import { assertMatterAccess } from '../../common/matter-access';
import { parse } from '../../common/validate';
import { setMatterStatus } from '../matters/matters.controller';

/** Hari pertama bulan (YYYY-MM-01) menurut zona waktu kantor. */
export function periodOf(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  return `${y}-${m}-01`;
}

function parseRegister(type: string): RegisterType {
  if (!(REGISTER_TYPES as readonly string[]).includes(type)) throw new AppError('NOT_FOUND', 'Jenis buku tidak dikenal', 404);
  return type as RegisterType;
}

/**
 * Ambil nomor berikutnya. UPDATE ... RETURNING mengunci baris penghitung sampai COMMIT,
 * sehingga permintaan bersamaan mendapat nomor berurutan, tidak pernah sama, tidak loncat.
 */
export async function takeNextNumber(trx: Trx, officeId: string, register: RegisterType, period: string): Promise<number> {
  await trx
    .insertInto('register_counters')
    .values({ office_id: officeId, register, period, locked_at: null, locked_by: null })
    .onConflict((oc) => oc.columns(['office_id', 'register', 'period']).doNothing())
    .execute();
  const row = await trx
    .updateTable('register_counters')
    .set((eb) => ({ last_number: eb('last_number', '+', 1) }))
    .where('office_id', '=', officeId)
    .where('register', '=', register)
    .where('period', '=', period)
    .where('locked_at', 'is', null)
    .returning('last_number')
    .executeTakeFirst();
  if (!row) throw new AppError('PERIOD_LOCKED', 'Buku bulan ini sudah dikunci (sudah dilaporkan)', 409);
  return row.last_number;
}

@Controller()
export class RegistryController {
  constructor(private readonly dbs: DbService) {}

  /** Penandatanganan: beri nomor akta + catat di buku daftar dalam satu transaksi. */
  @Can('deed.number')
  @RecentMfa()
  @Post('matters/:id/deeds')
  numberDeed(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) matterId: string, @Body() body: unknown) {
    const input = parse(numberDeedSchema, body);
    return this.dbs.as(auth, async (trx) => {
      const matter = await assertMatterAccess(trx, auth, matterId);
      if (matter.status !== 'scheduled') {
        throw new AppError('INVALID_STATE', 'Akta hanya bisa diberi nomor setelah draf disetujui (status Terjadwal)', 409);
      }
      const draft = await trx
        .selectFrom('deed_drafts')
        .select(['id', 'version'])
        .where('matter_id', '=', matterId)
        .where('status', '=', 'approved')
        .orderBy('version', 'desc')
        .executeTakeFirst();
      if (!draft) throw new AppError('NO_APPROVED_DRAFT', 'Belum ada draf yang disetujui', 409);

      const office = await trx.selectFrom('offices').select('timezone').where('id', '=', auth.officeId).executeTakeFirstOrThrow();
      const signedAt = input.signedAt ? new Date(input.signedAt) : new Date();
      const period = periodOf(signedAt, office.timezone);
      const number = await takeNextNumber(trx, auth.officeId, input.register, period);
      const deed = await trx
        .insertInto('deeds')
        .values({
          office_id: auth.officeId,
          matter_id: matterId,
          draft_id: draft.id,
          register: input.register,
          number,
          period,
          signed_at: signedAt,
          title: input.title,
          created_by: auth.userId,
        })
        .returning(['id', 'number', 'period', 'register'])
        .executeTakeFirstOrThrow();
      await setMatterStatus(trx, auth, matterId, 'scheduled', 'signed');
      await writeAudit(trx, auth, {
        action: 'deed.numbered',
        entity: 'matter',
        entityId: matterId,
        detail: { deedId: deed.id, register: deed.register, number, period },
      });
      await emit(trx, auth.officeId, 'deed.numbered', { deedId: deed.id, matterId, number, register: deed.register });
      return deed;
    });
  }

  @Can('register.read')
  @Get('registers/:type')
  list(@Auth() auth: AuthContext, @Param('type') type: string, @Query('month') month: string) {
    const register = parseRegister(type);
    const m = parse(monthSchema, month);
    return this.dbs.as(auth, async (trx) => {
      const period = `${m}-01`;
      const [entries, counter] = await Promise.all([
        this.entries(trx, register, period),
        trx
          .selectFrom('register_counters as r')
          .leftJoin('users as u', 'u.id', 'r.locked_by')
          .select(['r.last_number as lastNumber', 'r.locked_at as lockedAt', 'u.full_name as lockedBy'])
          .where('r.register', '=', register)
          .where('r.period', '=', period)
          .executeTakeFirst(),
      ]);
      return { register, month: m, lastNumber: counter?.lastNumber ?? 0, lockedAt: counter?.lockedAt ?? null, lockedBy: counter?.lockedBy ?? null, entries };
    });
  }

  /** Kunci bulan setelah laporan ke MPD dikirim; tidak ada nomor baru di bulan itu. */
  @Can('register.lock')
  @RecentMfa()
  @Post('registers/:type/:month/lock')
  @HttpCode(200)
  lock(@Auth() auth: AuthContext, @Param('type') type: string, @Param('month') month: string) {
    const register = parseRegister(type);
    const period = `${parse(monthSchema, month)}-01`;
    return this.dbs.as(auth, async (trx) => {
      await trx
        .insertInto('register_counters')
        .values({ office_id: auth.officeId, register, period, locked_at: null, locked_by: null })
        .onConflict((oc) => oc.columns(['office_id', 'register', 'period']).doNothing())
        .execute();
      const res = await trx
        .updateTable('register_counters')
        .set({ locked_at: new Date(), locked_by: auth.userId })
        .where('register', '=', register)
        .where('period', '=', period)
        .where('locked_at', 'is', null)
        .executeTakeFirst();
      if (!res.numUpdatedRows) throw new AppError('ALREADY_LOCKED', 'Bulan ini sudah dikunci', 409);
      await writeAudit(trx, auth, { action: 'register.locked', entity: 'register', entityId: `${register}:${month}` });
      return { ok: true };
    });
  }

  @Can('register.read')
  @Get('registers/:type/export')
  async export(@Auth() auth: AuthContext, @Param('type') type: string, @Query('month') month: string, @Res() res: Response) {
    const register = parseRegister(type);
    const m = parse(monthSchema, month);
    const entries = await this.dbs.as(auth, async (trx) => {
      await writeAudit(trx, auth, { action: 'register.exported', entity: 'register', entityId: `${register}:${m}` });
      return this.entries(trx, register, `${m}-01`);
    });
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['No. Urut', 'Nomor Akta', 'Tanggal', 'Sifat Akta', 'Nama Penghadap', 'No. Berkas'].map(esc).join(','),
      ...entries.map((e, i) =>
        [i + 1, e.number, new Date(e.signedAt).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }), e.title, e.parties, e.matterCode].map(esc).join(','),
      ),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${register}-${m}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send('﻿' + lines.join('\r\n'));
  }

  private entries(trx: Trx, register: RegisterType, period: string) {
    return trx
      .selectFrom('deeds as d')
      .innerJoin('matters as m', 'm.id', 'd.matter_id')
      .select([
        'd.id',
        'd.number',
        'd.signed_at as signedAt',
        'd.title',
        'm.id as matterId',
        'm.code as matterCode',
        sql<string>`(select string_agg(c.full_name, ', ' order by c.full_name)
                      from matter_parties p join clients c on c.id = p.client_id where p.matter_id = m.id)`.as('parties'),
      ])
      .where('d.register', '=', register)
      .where('d.period', '=', period)
      .orderBy('d.number')
      .execute();
  }
}
