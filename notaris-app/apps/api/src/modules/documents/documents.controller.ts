import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Auth, AuthContext, Can, Public } from '../../common/auth/auth-context';
import { CryptoService } from '../../common/crypto.service';
import { DbService, writeAudit } from '../../common/db.service';
import { AppError, NotFound } from '../../common/errors';
import { assertMatterAccess } from '../../common/matter-access';
import { config } from '../../config';
import { DocumentsService, UploadedFile as File } from './documents.service';
import { StorageService } from './storage.service';

const LINK_TTL_SECONDS = 15 * 60;

export const uploadInterceptor = () =>
  FileInterceptor('file', { limits: { fileSize: config().MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });

@Controller()
export class DocumentsController {
  constructor(
    private readonly dbs: DbService,
    private readonly docs: DocumentsService,
    private readonly crypto: CryptoService,
    private readonly storage: StorageService,
  ) {}

  @Can('document.write')
  @Post('matters/:id/documents')
  @UseInterceptors(uploadInterceptor())
  upload(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) matterId: string, @UploadedFile() file: File, @Body() body: unknown) {
    return this.dbs.as(auth, async (trx) => {
      await assertMatterAccess(trx, auth, matterId);
      return this.docs.saveUpload(trx, auth, matterId, file, body);
    });
  }

  /** Terbitkan link unduh bertanda tangan yang berlaku 15 menit. */
  @Get('documents/:id/link')
  link(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.dbs.as(auth, async (trx) => {
      const doc = await trx.selectFrom('documents').selectAll().where('id', '=', id).executeTakeFirst();
      if (!doc || !doc.matter_id) throw NotFound('Dokumen');
      await assertMatterAccess(trx, auth, doc.matter_id);
      if (doc.status !== 'ready') throw new AppError('DOCUMENT_NOT_READY', 'Dokumen masih dipindai atau dikarantina', 409);
      const token = this.crypto.sign(
        { d: doc.id, o: auth.officeId, a: auth.kind === 'staff' ? auth.userId : auth.clientId, k: auth.kind },
        LINK_TTL_SECONDS,
      );
      await writeAudit(trx, auth, { action: 'document.link_issued', entity: 'matter', entityId: doc.matter_id, detail: { documentId: id } });
      return { url: `/api/v1/files/${token}`, expiresIn: LINK_TTL_SECONDS };
    });
  }

  /** Unduh lewat token bertanda tangan; tidak butuh cookie agar bisa dibuka di tab baru. */
  @Public()
  @Get('files/:token')
  async file(@Param('token') token: string, @Res() res: Response) {
    const payload = this.crypto.verify<{ d: string; o: string; a: string; k: 'staff' | 'client' }>(token);
    if (!payload) throw new AppError('LINK_EXPIRED', 'Link unduh tidak valid atau sudah kedaluwarsa', 410);
    const doc = await this.dbs.tx({ officeId: payload.o }, async (trx) => {
      const d = await trx.selectFrom('documents').selectAll().where('id', '=', payload.d).executeTakeFirst();
      if (!d || d.status !== 'ready') throw NotFound('Dokumen');
      await trx
        .insertInto('audit_log')
        .values({
          office_id: payload.o,
          actor_type: payload.k,
          actor_id: payload.a,
          action: 'document.downloaded',
          entity: 'matter',
          entity_id: d.matter_id,
          ip: res.req.ip ?? null,
          detail: JSON.stringify({ documentId: d.id }),
        })
        .execute();
      return d;
    });
    res.setHeader('Content-Type', doc.mime);
    res.setHeader('Content-Disposition', `inline; filename="${doc.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    this.storage.stream(doc.storage_key).pipe(res);
  }
}
