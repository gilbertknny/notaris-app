import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { sql } from 'kysely';
import {
  assignSchema,
  createMatterSchema,
  isManualTransition,
  MATTER_STATUSES,
  MATTER_TRANSITIONS,
  MatterStatus,
  maskId,
  SENSITIVE_SERVICES,
  ServiceType,
  transitionSchema,
} from '@notaris/shared';
import { Auth, AuthContext, Can } from '../../common/auth/auth-context';
import { CryptoService } from '../../common/crypto.service';
import { DbService, emit, Trx, writeAudit } from '../../common/db.service';
import { AppError, NotFound } from '../../common/errors';
import { assertMatterAccess } from '../../common/matter-access';
import { parse } from '../../common/validate';
import { clientExists } from '../clients/clients.controller';

@Controller('matters')
export class MattersController {
  constructor(
    private readonly dbs: DbService,
    private readonly crypto: CryptoService,
  ) {}

  @Get()
  list(@Auth() auth: AuthContext, @Query('status') status?: string, @Query('q') q?: string) {
    return this.dbs.as(auth, async (trx) => {
      let query = trx
        .selectFrom('matters as m')
        .innerJoin('users as u', 'u.id', 'm.owner_id')
        .select([
          'm.id',
          'm.code',
          'm.title',
          'm.service_type as serviceType',
          'm.status',
          'm.due_date as dueDate',
          'm.is_sensitive as isSensitive',
          'm.created_at as createdAt',
          'u.full_name as ownerName',
          sql<string>`(select string_agg(c.full_name, ', ' order by c.full_name)
                        from matter_parties p join clients c on c.id = p.client_id
                       where p.matter_id = m.id)`.as('parties'),
        ])
        .orderBy('m.created_at', 'desc')
        .limit(200);
      if (!auth.permissions.has('matter.read_all')) {
        query = query.where(({ exists, selectFrom }) =>
          exists(
            selectFrom('matter_assignments as a').select('a.user_id').whereRef('a.matter_id', '=', 'm.id').where('a.user_id', '=', auth.userId!),
          ),
        );
      }
      if (status && (MATTER_STATUSES as readonly string[]).includes(status)) {
        query = query.where('m.status', '=', status as MatterStatus);
      }
      const term = q?.trim().replace(/[%_]/g, '');
      if (term) {
        query = query.where((eb) =>
          eb.or([
            eb('m.code', 'ilike', `%${term}%`),
            eb('m.title', 'ilike', `%${term}%`),
            eb.exists(
              eb
                .selectFrom('matter_parties as p2')
                .innerJoin('clients as c2', 'c2.id', 'p2.client_id')
                .select('p2.client_id')
                .whereRef('p2.matter_id', '=', 'm.id')
                .where('c2.full_name', 'ilike', `%${term}%`),
            ),
          ]),
        );
      }
      return query.execute();
    });
  }

  @Can('matter.create')
  @Post()
  create(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(createMatterSchema, body);
    return this.dbs.as(auth, async (trx) => {
      for (const p of input.parties) {
        if (!(await clientExists(trx, p.clientId))) throw NotFound('Klien');
      }
      const code = await nextMatterCode(trx, auth.officeId);
      const matter = await trx
        .insertInto('matters')
        .values({
          office_id: auth.officeId,
          code,
          service_type: input.serviceType,
          title: input.title,
          owner_id: auth.userId!,
          due_date: input.dueDate ?? null,
          is_sensitive: SENSITIVE_SERVICES.includes(input.serviceType as ServiceType),
          created_by: auth.userId,
          updated_by: auth.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx.insertInto('matter_assignments').values({ office_id: auth.officeId, matter_id: matter.id, user_id: auth.userId! }).execute();
      await trx
        .insertInto('matter_parties')
        .values(input.parties.map((p) => ({ office_id: auth.officeId, matter_id: matter.id, client_id: p.clientId, role: p.role })))
        .execute();
      await writeAudit(trx, auth, { action: 'matter.created', entity: 'matter', entityId: matter.id, detail: { code } });
      await emit(trx, auth.officeId, 'matter.created', { matterId: matter.id });
      return { id: matter.id, code: matter.code };
    });
  }

  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.dbs.as(auth, async (trx) => {
      const m = await assertMatterAccess(trx, auth, id);
      const [owner, parties, assignees, documents, drafts, deeds, invoices, appointments, history] = await Promise.all([
        trx.selectFrom('users').select(['id', 'full_name as fullName']).where('id', '=', m.owner_id).executeTakeFirst(),
        trx
          .selectFrom('matter_parties as p')
          .innerJoin('clients as c', 'c.id', 'p.client_id')
          .select(['c.id', 'c.full_name as fullName', 'c.type', 'c.nik_enc', 'p.role', 'c.phone', 'c.email'])
          .where('p.matter_id', '=', id)
          .execute(),
        trx
          .selectFrom('matter_assignments as a')
          .innerJoin('users as u', 'u.id', 'a.user_id')
          .select(['u.id', 'u.full_name as fullName'])
          .where('a.matter_id', '=', id)
          .execute(),
        trx
          .selectFrom('documents')
          .select(['id', 'kind', 'filename', 'mime', 'size_bytes as sizeBytes', 'status', 'version', 'created_at as createdAt', 'uploaded_by_client as uploadedByClient'])
          .where('matter_id', '=', id)
          .orderBy('created_at', 'desc')
          .execute(),
        trx
          .selectFrom('deed_drafts as d')
          .innerJoin('templates as t', 't.id', 'd.template_id')
          .select(['d.id', 'd.version', 'd.status', 'd.return_note as returnNote', 'd.created_at as createdAt', 'd.approved_at as approvedAt', 't.name as templateName'])
          .where('d.matter_id', '=', id)
          .orderBy('d.version', 'desc')
          .execute(),
        trx
          .selectFrom('deeds')
          .select(['id', 'register', 'number', 'period', 'signed_at as signedAt', 'title'])
          .where('matter_id', '=', id)
          .execute(),
        trx
          .selectFrom('invoices')
          .select(['id', 'number', 'amount', 'tax_escrow as taxEscrow', 'status', 'issued_at as issuedAt', 'due_date as dueDate', 'description'])
          .where('matter_id', '=', id)
          .orderBy('issued_at', 'desc')
          .execute(),
        trx
          .selectFrom('appointments')
          .select(['id', 'starts_at as startsAt', 'ends_at as endsAt', 'room', 'note'])
          .where('matter_id', '=', id)
          .where('cancelled_at', 'is', null)
          .orderBy('starts_at')
          .execute(),
        trx
          .selectFrom('audit_log as l')
          .leftJoin('users as u', 'u.id', 'l.actor_id')
          .select(['l.id', 'l.action', 'l.at', 'l.detail', 'u.full_name as actorName', 'l.actor_type as actorType'])
          .where('l.entity', 'in', ['matter', 'matters'])
          .where('l.entity_id', '=', id)
          .where('l.action', '!=', 'matter.viewed')
          .orderBy('l.at', 'desc')
          .limit(50)
          .execute(),
      ]);
      await writeAudit(trx, auth, { action: 'matter.viewed', entity: 'matter', entityId: id });
      return {
        id: m.id,
        code: m.code,
        title: m.title,
        serviceType: m.service_type,
        status: m.status,
        dueDate: m.due_date,
        isSensitive: m.is_sensitive,
        createdAt: m.created_at,
        owner,
        parties: await Promise.all(
          parties.map(async (p) => ({
            id: p.id,
            fullName: p.fullName,
            type: p.type,
            role: p.role,
            phone: p.phone,
            email: p.email,
            nikMasked: maskId(await this.crypto.decrypt(trx, auth.officeId, p.nik_enc)),
          })),
        ),
        assignees,
        documents,
        drafts,
        deeds,
        invoices,
        appointments,
        history,
        nextStatuses: MATTER_TRANSITIONS[m.status].filter((to) => isManualTransition(m.status, to)),
      };
    });
  }

  @Can('matter.assign')
  @Post(':id/assign')
  @HttpCode(200)
  assign(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { userId } = parse(assignSchema, body);
    return this.dbs.as(auth, async (trx) => {
      await assertMatterAccess(trx, auth, id);
      const user = await trx.selectFrom('users').select(['id', 'active']).where('id', '=', userId).where('office_id', '=', auth.officeId).executeTakeFirst();
      if (!user || !user.active) throw NotFound('Pengguna');
      await trx
        .insertInto('matter_assignments')
        .values({ office_id: auth.officeId, matter_id: id, user_id: userId })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await writeAudit(trx, auth, { action: 'matter.assigned', entity: 'matter', entityId: id, detail: { userId } });
      return { ok: true };
    });
  }

  @Can('matter.assign')
  @Delete(':id/assign/:userId')
  unassign(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.dbs.as(auth, async (trx) => {
      const m = await assertMatterAccess(trx, auth, id);
      if (m.owner_id === userId) throw new AppError('INVALID', 'Penanggung jawab utama tidak bisa dilepas');
      await trx.deleteFrom('matter_assignments').where('matter_id', '=', id).where('user_id', '=', userId).execute();
      await writeAudit(trx, auth, { action: 'matter.unassigned', entity: 'matter', entityId: id, detail: { userId } });
      return { ok: true };
    });
  }

  /** Transisi manual (mis. intake → documents). Transisi review/signed hanya lewat modul draf & akta. */
  @Can('matter.transition')
  @Post(':id/transition')
  @HttpCode(200)
  transition(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { to, note } = parse(transitionSchema, body);
    return this.dbs.as(auth, async (trx) => {
      const m = await assertMatterAccess(trx, auth, id);
      if (!isManualTransition(m.status, to)) {
        throw new AppError('INVALID_TRANSITION', `Status tidak bisa diubah dari ${m.status} ke ${to}`, 409);
      }
      await setMatterStatus(trx, auth, id, m.status, to, note);
      return { status: to };
    });
  }
}

/** Ubah status + audit + event. Satu-satunya jalan untuk mengubah kolom status. */
export async function setMatterStatus(trx: Trx, auth: AuthContext, matterId: string, from: MatterStatus, to: MatterStatus, note?: string) {
  const res = await trx
    .updateTable('matters')
    .set({ status: to, updated_at: new Date(), updated_by: auth.userId })
    .where('id', '=', matterId)
    .where('status', '=', from) // cegah balapan dua staf mengubah status bersamaan
    .executeTakeFirst();
  if (!res.numUpdatedRows) throw new AppError('CONFLICT', 'Status berkas berubah oleh pengguna lain, muat ulang halaman', 409);
  await emit(trx, auth.officeId, 'matter.status_changed', { matterId, from, to, note: note ?? null });
}

/** Nomor berkas internal: YYYY/MM/NNNN, dikunci per bulan. */
async function nextMatterCode(trx: Trx, officeId: string) {
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  await trx
    .insertInto('matter_code_counters')
    .values({ office_id: officeId, period })
    .onConflict((oc) => oc.columns(['office_id', 'period']).doNothing())
    .execute();
  const { last_number } = await trx
    .updateTable('matter_code_counters')
    .set((eb) => ({ last_number: eb('last_number', '+', 1) }))
    .where('office_id', '=', officeId)
    .where('period', '=', period)
    .returning('last_number')
    .executeTakeFirstOrThrow();
  return `${period.slice(0, 4)}/${period.slice(5, 7)}/${String(last_number).padStart(4, '0')}`;
}
