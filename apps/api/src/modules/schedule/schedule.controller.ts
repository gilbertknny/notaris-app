import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { createAppointmentSchema } from '@notaris/shared';
import { Auth, AuthContext, Can } from '../../common/auth/auth-context';
import { DbService, emit, writeAudit } from '../../common/db.service';
import { AppError, NotFound } from '../../common/errors';
import { assertMatterAccess } from '../../common/matter-access';
import { parse } from '../../common/validate';

@Controller('appointments')
export class ScheduleController {
  constructor(private readonly dbs: DbService) {}

  @Get()
  list(@Auth() auth: AuthContext, @Query('from') from?: string, @Query('to') to?: string) {
    const start = from ? new Date(from) : new Date(new Date().setHours(0, 0, 0, 0));
    const end = to ? new Date(to) : new Date(start.getTime() + 14 * 86400_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new AppError('VALIDATION', 'Tanggal tidak valid');
    return this.dbs.as(auth, (trx) => {
      let q = trx
        .selectFrom('appointments as a')
        .innerJoin('matters as m', 'm.id', 'a.matter_id')
        .select(['a.id', 'a.starts_at as startsAt', 'a.ends_at as endsAt', 'a.room', 'a.note', 'm.id as matterId', 'm.code as matterCode', 'm.title as matterTitle'])
        .where('a.cancelled_at', 'is', null)
        .where('a.starts_at', '>=', start)
        .where('a.starts_at', '<', end)
        .orderBy('a.starts_at');
      if (!auth.permissions.has('matter.read_all')) {
        q = q.where(({ exists, selectFrom }) =>
          exists(selectFrom('matter_assignments as x').select('x.user_id').whereRef('x.matter_id', '=', 'm.id').where('x.user_id', '=', auth.userId!)),
        );
      }
      return q.execute();
    });
  }

  @Can('schedule.write')
  @Post()
  create(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(createAppointmentSchema, body);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (endsAt <= startsAt) throw new AppError('VALIDATION', 'Waktu selesai harus setelah waktu mulai');
    return this.dbs.as(auth, async (trx) => {
      await assertMatterAccess(trx, auth, input.matterId);
      if (input.room) {
        const clash = await trx
          .selectFrom('appointments')
          .select('id')
          .where('room', '=', input.room)
          .where('cancelled_at', 'is', null)
          .where('starts_at', '<', endsAt)
          .where('ends_at', '>', startsAt)
          .executeTakeFirst();
        if (clash) throw new AppError('ROOM_BOOKED', `Ruang ${input.room} sudah terpakai di jam tersebut`, 409);
      }
      const appt = await trx
        .insertInto('appointments')
        .values({
          office_id: auth.officeId,
          matter_id: input.matterId,
          starts_at: startsAt,
          ends_at: endsAt,
          room: input.room ?? null,
          note: input.note ?? null,
          created_by: auth.userId,
          cancelled_at: null,
        })
        .returning(['id', 'starts_at as startsAt', 'ends_at as endsAt', 'room'])
        .executeTakeFirstOrThrow();
      await writeAudit(trx, auth, { action: 'appointment.created', entity: 'matter', entityId: input.matterId, detail: { appointmentId: appt.id } });
      await emit(trx, auth.officeId, 'appointment.created', { appointmentId: appt.id, matterId: input.matterId });
      return appt;
    });
  }

  @Can('schedule.write')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.dbs.as(auth, async (trx) => {
      const appt = await trx.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirst();
      if (!appt || appt.cancelled_at) throw NotFound('Jadwal');
      await assertMatterAccess(trx, auth, appt.matter_id);
      await trx.updateTable('appointments').set({ cancelled_at: new Date() }).where('id', '=', id).execute();
      await writeAudit(trx, auth, { action: 'appointment.cancelled', entity: 'matter', entityId: appt.matter_id, detail: { appointmentId: id } });
      return { ok: true };
    });
  }
}
