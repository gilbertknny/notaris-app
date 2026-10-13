import { Controller, Get, Query } from '@nestjs/common';
import { sql } from 'kysely';
import { monthSchema } from '@notaris/shared';
import { Auth, AuthContext, Can } from '../../common/auth/auth-context';
import { DbService } from '../../common/db.service';
import { parse } from '../../common/validate';

@Controller()
export class ReportsController {
  constructor(private readonly dbs: DbService) {}

  /** Ringkasan untuk beranda staf; hanya berkas yang boleh dilihat pengguna. */
  @Get('dashboard')
  dashboard(@Auth() auth: AuthContext) {
    return this.dbs.as(auth, async (trx) => {
      const scoped = auth.permissions.has('matter.read_all')
        ? sql<boolean>`true`
        : sql<boolean>`exists (select 1 from matter_assignments a where a.matter_id = m.id and a.user_id = ${auth.userId})`;
      const [byStatus, dueSoon, today, approvals, newDocs] = await Promise.all([
        trx
          .selectFrom('matters as m')
          .select(['m.status', sql<number>`count(*)::int`.as('count')])
          .where(scoped)
          .groupBy('m.status')
          .execute(),
        trx
          .selectFrom('matters as m')
          .select(['m.id', 'm.code', 'm.title', 'm.status', 'm.due_date as dueDate'])
          .where(scoped)
          .where('m.due_date', 'is not', null)
          .where(sql<boolean>`m.due_date <= current_date + 7`)
          .where('m.status', 'not in', ['done', 'cancelled'])
          .orderBy('m.due_date')
          .limit(10)
          .execute(),
        trx
          .selectFrom('appointments as a')
          .innerJoin('matters as m', 'm.id', 'a.matter_id')
          .select(['a.id', 'a.starts_at as startsAt', 'a.room', 'm.id as matterId', 'm.code', 'm.title'])
          .where(scoped)
          .where('a.cancelled_at', 'is', null)
          .where(sql<boolean>`(a.starts_at at time zone 'Asia/Jakarta')::date = (now() at time zone 'Asia/Jakarta')::date`)
          .orderBy('a.starts_at')
          .execute(),
        auth.permissions.has('draft.approve')
          ? trx.selectFrom('deed_drafts').select(sql<number>`count(*)::int`.as('n')).where('status', '=', 'submitted').executeTakeFirst()
          : Promise.resolve(undefined),
        trx
          .selectFrom('documents as d')
          .innerJoin('matters as m', 'm.id', 'd.matter_id')
          .select(['d.id', 'd.kind', 'd.filename', 'd.status', 'd.created_at as createdAt', 'm.id as matterId', 'm.code'])
          .where(scoped)
          .where('d.uploaded_by_client', 'is not', null)
          .where(sql<boolean>`d.created_at > now() - interval '7 days'`)
          .orderBy('d.created_at', 'desc')
          .limit(10)
          .execute(),
      ]);
      return { byStatus, dueSoon, today, pendingApprovals: approvals?.n ?? null, newClientDocuments: newDocs };
    });
  }

  @Can('report.read')
  @Get('reports/monthly')
  monthly(@Auth() auth: AuthContext, @Query('month') month: string) {
    const m = parse(monthSchema, month);
    const start = `${m}-01`;
    return this.dbs.as(auth, async (trx) => {
      const range = sql<boolean>`>= ${start}::date and created_at < (${start}::date + interval '1 month')`;
      const [deeds, opened, finished, invoiced, paid] = await Promise.all([
        trx
          .selectFrom('deeds')
          .select(['register', sql<number>`count(*)::int`.as('count'), sql<number>`max(number)`.as('lastNumber')])
          .where('period', '=', start)
          .groupBy('register')
          .execute(),
        trx.selectFrom('matters').select(sql<number>`count(*)::int`.as('n')).where(sql<boolean>`created_at ${range}`).executeTakeFirstOrThrow(),
        trx
          .selectFrom('matters')
          .select(sql<number>`count(*)::int`.as('n'))
          .where('status', '=', 'done')
          .where(sql<boolean>`updated_at >= ${start}::date and updated_at < (${start}::date + interval '1 month')`)
          .executeTakeFirstOrThrow(),
        trx
          .selectFrom('invoices')
          .select(sql<string>`coalesce(sum(amount), 0)`.as('total'))
          .where(sql<boolean>`issued_at >= ${start}::date and issued_at < (${start}::date + interval '1 month')`)
          .executeTakeFirstOrThrow(),
        trx
          .selectFrom('payments')
          .select(sql<string>`coalesce(sum(amount), 0)`.as('total'))
          .where(sql<boolean>`paid_at >= ${start}::date and paid_at < (${start}::date + interval '1 month')`)
          .executeTakeFirstOrThrow(),
      ]);
      return {
        month: m,
        deedsByRegister: deeds,
        mattersOpened: opened.n,
        mattersDone: finished.n,
        invoicedTotal: Number(invoiced.total),
        paidTotal: Number(paid.total),
      };
    });
  }

  @Can('audit.read')
  @Get('audit-logs')
  audit(@Auth() auth: AuthContext, @Query('action') action?: string, @Query('limit') limit?: string) {
    return this.dbs.as(auth, (trx) => {
      let q = trx
        .selectFrom('audit_log as l')
        .leftJoin('users as u', 'u.id', 'l.actor_id')
        .select(['l.id', 'l.at', 'l.action', 'l.entity', 'l.entity_id as entityId', 'l.actor_type as actorType', 'u.full_name as actorName', 'l.ip', 'l.detail'])
        .orderBy('l.at', 'desc')
        .limit(Math.min(Number(limit) || 100, 500));
      if (action) q = q.where('l.action', 'like', `${action.replace(/[%_]/g, '')}%`);
      return q.execute();
    });
  }
}
