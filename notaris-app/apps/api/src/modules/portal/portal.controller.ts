import { Body, Controller, Get, HttpCode, Logger, Param, ParseUUIDPipe, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import { DOCUMENT_KINDS, MATTER_STATUS_LABEL, MatterStatus, portalOtpRequestSchema, portalOtpVerifySchema } from '@notaris/shared';
import { Auth, AuthContext, Portal, Public } from '../../common/auth/auth-context';
import { CryptoService } from '../../common/crypto.service';
import { DbService, emit, writeAudit } from '../../common/db.service';
import { AppError } from '../../common/errors';
import { assertMatterAccess } from '../../common/matter-access';
import { RedisService } from '../../common/redis.service';
import { parse } from '../../common/validate';
import { config } from '../../config';
import { SessionService } from '../auth/session.service';
import { uploadInterceptor } from '../documents/documents.controller';
import { DocumentsService, UploadedFile as File } from '../documents/documents.service';

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 3;

/** Langkah berikutnya yang ditampilkan ke klien, dalam bahasa sederhana. */
const NEXT_STEP: Record<MatterStatus, string> = {
  intake: 'Kantor sedang memeriksa data Anda.',
  documents: 'Mohon lengkapi dokumen yang diminta.',
  drafting: 'Kantor sedang menyusun draf akta.',
  review: 'Draf sedang diperiksa Notaris.',
  scheduled: 'Menunggu jadwal penandatanganan.',
  signed: 'Akta sudah ditandatangani.',
  filing: 'Sedang diproses di instansi terkait.',
  done: 'Selesai. Salinan bisa diambil di kantor.',
  cancelled: 'Berkas dibatalkan.',
};

@Controller('portal')
export class PortalController {
  private readonly logger = new Logger('Portal');

  constructor(
    private readonly dbs: DbService,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
    private readonly docs: DocumentsService,
  ) {}

  /** Minta OTP. Respons selalu sama agar tidak membocorkan email mana yang terdaftar. */
  @Public()
  @Post('auth/otp')
  @HttpCode(200)
  async requestOtp(@Body() body: unknown) {
    const { email } = parse(portalOtpRequestSchema, body);
    const generic = { ok: true, message: 'Jika email terdaftar, kode akan dikirim.' };
    if ((await this.redis.hit(`otp:req:${email}`, 15 * 60)) > 3) {
      throw new AppError('TOO_MANY_ATTEMPTS', 'Terlalu banyak permintaan kode. Coba lagi nanti.', 429);
    }
    const found = await this.findClient(email);
    if (!found) return generic;

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.dbs.tx({ officeId: found.office_id }, async (trx) => {
      await trx.updateTable('client_otps').set({ used_at: new Date() }).where('client_id', '=', found.client_id).where('used_at', 'is', null).execute();
      await trx
        .insertInto('client_otps')
        .values({
          office_id: found.office_id,
          client_id: found.client_id,
          code_hash: this.crypto.searchHash(found.office_id, `otp:${found.client_id}:${code}`)!,
          expires_at: new Date(Date.now() + OTP_TTL_MS),
          used_at: null,
        })
        .execute();
      // Isi pesan tidak memuat data sensitif selain kode itu sendiri.
      await emit(trx, found.office_id, 'notification.send', {
        channel: 'email',
        recipient: email,
        template: 'portal_otp',
        body: `Kode masuk portal Anda: ${code}. Berlaku 5 menit. Jangan berikan kode ini kepada siapa pun.`,
      });
    });
    if (config().NODE_ENV !== 'production') this.logger.warn(`[DEV] OTP untuk ${email}: ${code}`);
    return generic;
  }

  @Public()
  @Post('auth/verify')
  @HttpCode(200)
  async verifyOtp(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { email, code } = parse(portalOtpVerifySchema, body);
    const invalid = new AppError('INVALID_OTP', 'Kode salah atau sudah kedaluwarsa', 401);
    const found = await this.findClient(email);
    if (!found) throw invalid;

    const ok = await this.dbs.tx({ officeId: found.office_id }, async (trx) => {
      const otp = await trx
        .selectFrom('client_otps')
        .selectAll()
        .where('client_id', '=', found.client_id)
        .where('used_at', 'is', null)
        .where('expires_at', '>', new Date())
        .orderBy('created_at', 'desc')
        .forUpdate()
        .executeTakeFirst();
      if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) return false;
      const expected = this.crypto.searchHash(found.office_id, `otp:${found.client_id}:${code}`)!;
      if (!timingSafeEqual(expected, otp.code_hash)) {
        const attempts = otp.attempts + 1;
        await trx
          .updateTable('client_otps')
          .set({ attempts, used_at: attempts >= OTP_MAX_ATTEMPTS ? new Date() : null })
          .where('id', '=', otp.id)
          .execute();
        return false;
      }
      await trx.updateTable('client_otps').set({ used_at: new Date() }).where('id', '=', otp.id).execute();
      await writeAudit(trx, null, { officeId: found.office_id, action: 'portal.login', entity: 'client', entityId: found.client_id });
      return true;
    });
    if (!ok) throw invalid;
    await this.sessions.create('client', { officeId: found.office_id, clientId: found.client_id }, req, res);
    return { ok: true };
  }

  @Portal()
  @Post('auth/logout')
  @HttpCode(200)
  async logout(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(auth.sessionId);
    this.sessions.clear(res, 'client');
    return { ok: true };
  }

  @Portal()
  @Get('me')
  async me(@Auth() auth: AuthContext) {
    const office = await this.dbs.db.selectFrom('offices').select(['name', 'notary_name']).where('id', '=', auth.officeId).executeTakeFirstOrThrow();
    return { fullName: auth.fullName, office: { name: office.name, notaryName: office.notary_name } };
  }

  @Portal()
  @Get('matters')
  matters(@Auth() auth: AuthContext) {
    return this.dbs.as(auth, async (trx) => {
      const rows = await trx
        .selectFrom('matter_parties as p')
        .innerJoin('matters as m', 'm.id', 'p.matter_id')
        .select(['m.id', 'm.code', 'm.title', 'm.status', 'm.service_type as serviceType', 'm.updated_at as updatedAt', 'p.role'])
        .where('p.client_id', '=', auth.clientId!)
        .orderBy('m.updated_at', 'desc')
        .execute();
      return Promise.all(
        rows.map(async (m) => {
          const [documents, invoices, appointments] = await Promise.all([
            trx
              .selectFrom('documents')
              .select(['id', 'kind', 'filename', 'status', 'created_at as createdAt'])
              .where('matter_id', '=', m.id)
              .where('uploaded_by_client', '=', auth.clientId!)
              .orderBy('created_at', 'desc')
              .execute(),
            trx
              .selectFrom('invoices as i')
              .select([
                'i.id',
                'i.number',
                'i.amount',
                'i.tax_escrow as taxEscrow',
                'i.status',
                'i.due_date as dueDate',
                sql<string>`coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id), 0)`.as('paid'),
              ])
              .where('i.matter_id', '=', m.id)
              .where('i.status', '!=', 'void')
              .execute(),
            trx
              .selectFrom('appointments')
              .select(['id', 'starts_at as startsAt', 'room'])
              .where('matter_id', '=', m.id)
              .where('cancelled_at', 'is', null)
              .where('starts_at', '>', new Date())
              .orderBy('starts_at')
              .execute(),
          ]);
          return {
            ...m,
            statusLabel: MATTER_STATUS_LABEL[m.status],
            nextStep: NEXT_STEP[m.status],
            documents: documents.map((d) => ({ ...d, kindLabel: DOCUMENT_KINDS[d.kind as keyof typeof DOCUMENT_KINDS] ?? d.kind })),
            invoices,
            appointments,
          };
        }),
      );
    });
  }

  @Portal()
  @Post('matters/:id/documents')
  @UseInterceptors(uploadInterceptor())
  upload(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) matterId: string, @UploadedFile() file: File, @Body() body: Record<string, unknown>) {
    return this.dbs.as(auth, async (trx) => {
      const matter = await assertMatterAccess(trx, auth, matterId);
      if (['signed', 'filing', 'done', 'cancelled'].includes(matter.status)) {
        throw new AppError('INVALID_STATE', 'Berkas ini tidak lagi menerima dokumen', 409);
      }
      // Klien tidak bisa mengunggah atas nama pihak lain.
      return this.docs.saveUpload(trx, auth, matterId, file, { kind: body?.kind });
    });
  }

  private async findClient(email: string) {
    const r = await sql<{ client_id: string; office_id: string; full_name: string }>`select * from portal_find_client(${email})`.execute(this.dbs.db);
    return r.rows[0];
  }
}
