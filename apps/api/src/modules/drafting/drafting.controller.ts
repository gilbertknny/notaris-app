import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createDraftSchema, returnDraftSchema, updateDraftSchema } from '@notaris/shared';
import { Auth, AuthContext, Can, RecentMfa } from '../../common/auth/auth-context';
import { CryptoService } from '../../common/crypto.service';
import { DbService, emit, Trx, writeAudit } from '../../common/db.service';
import { AppError, NotFound } from '../../common/errors';
import { assertMatterAccess } from '../../common/matter-access';
import { parse } from '../../common/validate';
import { setMatterStatus } from '../matters/matters.controller';
import { renderTemplate } from './render-template';

@Controller()
export class DraftingController {
  constructor(
    private readonly dbs: DbService,
    private readonly crypto: CryptoService,
  ) {}

  @Can('draft.write')
  @Get('templates')
  templates(@Auth() auth: AuthContext, @Query('serviceType') serviceType?: string) {
    return this.dbs.as(auth, (trx) => {
      let q = trx.selectFrom('templates').select(['id', 'code', 'name', 'service_type as serviceType']).where('active', '=', true).orderBy('name');
      if (serviceType) q = q.where('service_type', '=', serviceType);
      return q.execute();
    });
  }

  @Can('draft.write')
  @Post('matters/:id/drafts')
  createDraft(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) matterId: string, @Body() body: unknown) {
    const { templateId } = parse(createDraftSchema, body);
    return this.dbs.as(auth, async (trx) => {
      const matter = await assertMatterAccess(trx, auth, matterId);
      if (matter.status !== 'drafting') {
        throw new AppError('INVALID_STATE', 'Draf hanya bisa dibuat saat berkas berstatus Penyusunan', 409);
      }
      const latest = await trx.selectFrom('deed_drafts').selectAll().where('matter_id', '=', matterId).orderBy('version', 'desc').executeTakeFirst();
      if (latest && latest.status === 'draft') {
        throw new AppError('DRAFT_EXISTS', 'Masih ada draf aktif; ubah draf itu atau kirim untuk persetujuan', 409, { draftId: latest.id });
      }
      const template = await trx.selectFrom('templates').selectAll().where('id', '=', templateId).executeTakeFirst();
      if (!template) throw NotFound('Template');

      const office = await trx.selectFrom('offices').selectAll().where('id', '=', auth.officeId).executeTakeFirstOrThrow();
      const parties = await trx
        .selectFrom('matter_parties as p')
        .innerJoin('clients as c', 'c.id', 'p.client_id')
        .select(['c.full_name', 'c.nik_enc', 'c.address_enc', 'p.role'])
        .where('p.matter_id', '=', matterId)
        .execute();
      const content = renderTemplate(template.body, {
        office: { name: office.name, notaryName: office.notary_name, regionCode: office.region_code },
        matter: { code: matter.code, title: matter.title },
        parties: await Promise.all(
          parties.map(async (p) => ({
            fullName: p.full_name,
            role: p.role,
            nik: await this.crypto.decrypt(trx, auth.officeId, p.nik_enc),
            address: await this.crypto.decrypt(trx, auth.officeId, p.address_enc),
          })),
        ),
        date: new Date(),
      });
      const draft = await trx
        .insertInto('deed_drafts')
        .values({
          office_id: auth.officeId,
          matter_id: matterId,
          template_id: templateId,
          version: (latest?.version ?? 0) + 1,
          content,
          return_note: null,
          submitted_at: null,
          approved_by: null,
          approved_at: null,
          created_by: auth.userId,
        })
        .returning(['id', 'version'])
        .executeTakeFirstOrThrow();
      await writeAudit(trx, auth, { action: 'draft.created', entity: 'matter', entityId: matterId, detail: { draftId: draft.id, version: draft.version } });
      return draft;
    });
  }

  @Get('drafts/:id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.dbs.as(auth, async (trx) => {
      const d = await this.loadDraft(trx, auth, id);
      const versions = await trx
        .selectFrom('deed_drafts')
        .select(['id', 'version', 'status'])
        .where('matter_id', '=', d.matter_id)
        .orderBy('version', 'desc')
        .execute();
      const matter = await trx.selectFrom('matters').select(['id', 'code', 'title', 'status']).where('id', '=', d.matter_id).executeTakeFirstOrThrow();
      return {
        id: d.id,
        version: d.version,
        status: d.status,
        content: d.content,
        returnNote: d.return_note,
        submittedAt: d.submitted_at,
        approvedAt: d.approved_at,
        matter,
        versions,
      };
    });
  }

  @Can('draft.write')
  @Put('drafts/:id')
  update(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { content } = parse(updateDraftSchema, body);
    return this.dbs.as(auth, async (trx) => {
      const d = await this.loadDraft(trx, auth, id);
      if (d.status !== 'draft') throw new AppError('INVALID_STATE', 'Hanya draf berstatus Draf yang bisa diubah; buat versi baru', 409);
      await trx.updateTable('deed_drafts').set({ content, updated_at: new Date() }).where('id', '=', id).execute();
      return { ok: true };
    });
  }

  @Can('draft.write')
  @Post('drafts/:id/submit')
  @HttpCode(200)
  submit(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.dbs.as(auth, async (trx) => {
      const d = await this.loadDraft(trx, auth, id);
      if (d.status !== 'draft') throw new AppError('INVALID_STATE', 'Draf ini sudah dikirim', 409);
      if (/\[\[[^\]]+\]\]/.test(d.content)) {
        throw new AppError('DRAFT_INCOMPLETE', 'Masih ada isian [[...]] yang belum dilengkapi', 422);
      }
      await trx.updateTable('deed_drafts').set({ status: 'submitted', submitted_at: new Date() }).where('id', '=', id).execute();
      await setMatterStatus(trx, auth, d.matter_id, 'drafting', 'review');
      await writeAudit(trx, auth, { action: 'draft.submitted', entity: 'matter', entityId: d.matter_id, detail: { draftId: id, version: d.version } });
      await emit(trx, auth.officeId, 'draft.submitted', { draftId: id, matterId: d.matter_id });
      return { status: 'submitted' };
    });
  }

  @Can('draft.approve')
  @RecentMfa()
  @Post('drafts/:id/approve')
  @HttpCode(200)
  approve(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.dbs.as(auth, async (trx) => {
      const d = await this.loadDraft(trx, auth, id);
      if (d.status !== 'submitted') throw new AppError('INVALID_STATE', 'Hanya draf yang menunggu persetujuan yang bisa disetujui', 409);
      await trx.updateTable('deed_drafts').set({ status: 'approved', approved_by: auth.userId, approved_at: new Date() }).where('id', '=', id).execute();
      await setMatterStatus(trx, auth, d.matter_id, 'review', 'scheduled');
      await writeAudit(trx, auth, { action: 'draft.approved', entity: 'matter', entityId: d.matter_id, detail: { draftId: id, version: d.version } });
      return { status: 'approved' };
    });
  }

  @Can('draft.approve')
  @Post('drafts/:id/return')
  @HttpCode(200)
  returnDraft(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { note } = parse(returnDraftSchema, body);
    return this.dbs.as(auth, async (trx) => {
      const d = await this.loadDraft(trx, auth, id);
      if (d.status !== 'submitted') throw new AppError('INVALID_STATE', 'Hanya draf yang menunggu persetujuan yang bisa dikembalikan', 409);
      await trx.updateTable('deed_drafts').set({ status: 'returned', return_note: note }).where('id', '=', id).execute();
      await setMatterStatus(trx, auth, d.matter_id, 'review', 'drafting', note);
      await writeAudit(trx, auth, { action: 'draft.returned', entity: 'matter', entityId: d.matter_id, detail: { draftId: id, note } });
      await emit(trx, auth.officeId, 'draft.returned', { draftId: id, matterId: d.matter_id });
      return { status: 'returned' };
    });
  }

  /** Antrean persetujuan Notaris. */
  @Can('draft.approve')
  @Get('approvals')
  approvals(@Auth() auth: AuthContext) {
    return this.dbs.as(auth, (trx) =>
      trx
        .selectFrom('deed_drafts as d')
        .innerJoin('matters as m', 'm.id', 'd.matter_id')
        .innerJoin('templates as t', 't.id', 'd.template_id')
        .leftJoin('users as u', 'u.id', 'd.created_by')
        .select(['d.id', 'd.version', 'd.submitted_at as submittedAt', 'm.id as matterId', 'm.code', 'm.title', 't.name as templateName', 'u.full_name as drafterName'])
        .where('d.status', '=', 'submitted')
        .orderBy('d.submitted_at')
        .execute(),
    );
  }

  @Get('drafts/:id/download')
  @Header('Cache-Control', 'no-store')
  async download(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const d = await this.dbs.as(auth, async (trx) => {
      const draft = await this.loadDraft(trx, auth, id);
      const matter = await trx.selectFrom('matters').select('code').where('id', '=', draft.matter_id).executeTakeFirstOrThrow();
      await writeAudit(trx, auth, { action: 'draft.downloaded', entity: 'matter', entityId: draft.matter_id, detail: { draftId: id } });
      return { ...draft, code: matter.code };
    });
    const watermark = `\n\n---\nDiunduh oleh ${auth.fullName} pada ${new Date().toISOString()} — DRAF, bukan salinan resmi.`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="draf-${d.code.replace(/\//g, '-')}-v${d.version}.txt"`);
    res.send(d.content + watermark);
  }

  private async loadDraft(trx: Trx, auth: AuthContext, id: string) {
    const d = await trx.selectFrom('deed_drafts').selectAll().where('id', '=', id).executeTakeFirst();
    if (!d) throw NotFound('Draf');
    await assertMatterAccess(trx, auth, d.matter_id);
    return d;
  }
}
