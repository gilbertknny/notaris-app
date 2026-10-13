import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { sql } from 'kysely';
import { createInvoiceSchema, createPaymentSchema } from '@notaris/shared';
import { Auth, AuthContext, Can } from '../../common/auth/auth-context';
import { DbService, emit, writeAudit } from '../../common/db.service';
import { AppError, NotFound } from '../../common/errors';
import { parse } from '../../common/validate';

/**
 * Keuangan: staf keuangan melihat ringkasan berkas + tagihan tanpa perlu ditugaskan,
 * tetapi tidak melihat isi draf, dokumen, atau data identitas klien.
 */
@Controller('invoices')
export class FinanceController {
  constructor(private readonly dbs: DbService) {}

  @Can('finance.read')
  @Get()
  list(@Auth() auth: AuthContext, @Query('status') status?: string) {
    return this.dbs.as(auth, (trx) => {
      let q = trx
        .selectFrom('invoices as i')
        .innerJoin('matters as m', 'm.id', 'i.matter_id')
        .select([
          'i.id',
          'i.number',
          'i.amount',
          'i.tax_escrow as taxEscrow',
          'i.status',
          'i.issued_at as issuedAt',
          'i.due_date as dueDate',
          'i.description',
          'm.id as matterId',
          'm.code as matterCode',
          'm.title as matterTitle',
          sql<string>`coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id), 0)`.as('paid'),
        ])
        .orderBy('i.issued_at', 'desc')
        .limit(200);
      if (status) q = q.where('i.status', '=', status as 'unpaid');
      return q.execute();
    });
  }

  @Can('finance.write')
  @Post()
  create(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(createInvoiceSchema, body);
    return this.dbs.as(auth, async (trx) => {
      const matter = await trx.selectFrom('matters').select(['id', 'code', 'status']).where('id', '=', input.matterId).executeTakeFirst();
      if (!matter) throw NotFound('Berkas');
      if (matter.status === 'cancelled') throw new AppError('INVALID_STATE', 'Berkas sudah dibatalkan');
      const { n } = await trx
        .selectFrom('invoices')
        .select(({ fn }) => fn.countAll<string>().as('n'))
        .where('matter_id', '=', matter.id)
        .executeTakeFirstOrThrow();
      const invoice = await trx
        .insertInto('invoices')
        .values({
          office_id: auth.officeId,
          matter_id: matter.id,
          number: `INV-${matter.code.replace(/\//g, '')}-${Number(n) + 1}`,
          description: input.description ?? null,
          amount: input.amount,
          tax_escrow: input.taxEscrow,
          due_date: input.dueDate ?? null,
          created_by: auth.userId,
        })
        .returning(['id', 'number', 'amount', 'status'])
        .executeTakeFirstOrThrow();
      await writeAudit(trx, auth, { action: 'invoice.created', entity: 'matter', entityId: matter.id, detail: { invoiceId: invoice.id, amount: input.amount } });
      await emit(trx, auth.officeId, 'invoice.created', { invoiceId: invoice.id, matterId: matter.id });
      return invoice;
    });
  }

  @Can('finance.write')
  @Post(':id/payments')
  pay(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(createPaymentSchema, body);
    return this.dbs.as(auth, async (trx) => {
      // Kunci baris invoice agar dua pembayaran bersamaan tidak salah hitung status.
      const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!inv) throw NotFound('Invoice');
      if (inv.status === 'void' || inv.status === 'paid') throw new AppError('INVALID_STATE', 'Invoice sudah lunas atau dibatalkan', 409);
      await trx
        .insertInto('payments')
        .values({ office_id: auth.officeId, invoice_id: id, amount: input.amount, method: input.method, reference: input.reference ?? null, created_by: auth.userId })
        .execute();
      const { paid } = await trx
        .selectFrom('payments')
        .select(({ fn }) => fn.sum<string>('amount').as('paid'))
        .where('invoice_id', '=', id)
        .executeTakeFirstOrThrow();
      const total = Number(inv.amount) + Number(inv.tax_escrow);
      const status = Number(paid) >= total ? 'paid' : 'partial';
      await trx.updateTable('invoices').set({ status }).where('id', '=', id).execute();
      await writeAudit(trx, auth, { action: 'payment.recorded', entity: 'matter', entityId: inv.matter_id, detail: { invoiceId: id, amount: input.amount, method: input.method } });
      return { status, paid: Number(paid), total };
    });
  }
}
