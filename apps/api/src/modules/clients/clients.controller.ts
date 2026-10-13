import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { sql } from 'kysely';
import { createClientSchema, maskId } from '@notaris/shared';
import { Auth, AuthContext, Can } from '../../common/auth/auth-context';
import { CryptoService } from '../../common/crypto.service';
import { DbService, Trx, writeAudit } from '../../common/db.service';
import { AppError, NotFound } from '../../common/errors';
import { parse } from '../../common/validate';

@Controller('clients')
export class ClientsController {
  constructor(
    private readonly dbs: DbService,
    private readonly crypto: CryptoService,
  ) {}

  @Can('client.read')
  @Get()
  list(@Auth() auth: AuthContext, @Query('q') q?: string) {
    return this.dbs.as(auth, async (trx) => {
      let query = trx
        .selectFrom('clients')
        .select(['id', 'type', 'full_name', 'nik_enc', 'phone', 'email', 'kyc_risk', 'created_at'])
        .where('archived_at', 'is', null)
        .orderBy('full_name')
        .limit(50);
      const term = q?.trim();
      if (term && /^\d{16}$/.test(term)) {
        // Cari berdasarkan NIK lewat HMAC, tanpa dekripsi massal.
        query = query.where('nik_hash', '=', this.crypto.searchHash(auth.officeId, term));
      } else if (term) {
        query = query.where('full_name', 'ilike', `%${term.replace(/[%_]/g, '')}%`);
      }
      const rows = await query.execute();
      return Promise.all(rows.map(async (r) => this.summary(trx, auth.officeId, r)));
    });
  }

  @Can('client.write')
  @Post()
  create(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(createClientSchema, body);
    return this.dbs.as(auth, async (trx) => {
      if (input.nik) {
        const dup = await trx
          .selectFrom('clients')
          .select('id')
          .where('nik_hash', '=', this.crypto.searchHash(auth.officeId, input.nik))
          .executeTakeFirst();
        if (dup) throw new AppError('CLIENT_DUPLICATE', 'Klien dengan NIK ini sudah terdaftar', 409, { clientId: dup.id });
      }
      const row = await trx
        .insertInto('clients')
        .values({
          office_id: auth.officeId,
          type: input.type,
          full_name: input.fullName,
          nik_enc: await this.crypto.encrypt(trx, auth.officeId, input.nik),
          nik_hash: this.crypto.searchHash(auth.officeId, input.nik),
          npwp_enc: await this.crypto.encrypt(trx, auth.officeId, input.npwp),
          npwp_hash: this.crypto.searchHash(auth.officeId, input.npwp),
          birth_date: input.birthDate ?? null,
          address_enc: await this.crypto.encrypt(trx, auth.officeId, input.address),
          phone: input.phone || null,
          email: input.email ?? null,
          kyc_risk: 'low',
          archived_at: null,
          created_by: auth.userId,
          updated_by: auth.userId,
        })
        .returning(['id', 'type', 'full_name', 'nik_enc', 'phone', 'email', 'kyc_risk', 'created_at'])
        .executeTakeFirstOrThrow();
      await writeAudit(trx, auth, { action: 'client.created', entity: 'client', entityId: row.id });
      return this.summary(trx, auth.officeId, row);
    });
  }

  @Can('client.read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.dbs.as(auth, async (trx) => {
      const c = await trx.selectFrom('clients').selectAll().where('id', '=', id).executeTakeFirst();
      if (!c) throw NotFound('Klien');
      const matters = await trx
        .selectFrom('matter_parties as p')
        .innerJoin('matters as m', 'm.id', 'p.matter_id')
        .select(['m.id', 'm.code', 'm.title', 'm.status', 'p.role'])
        .where('p.client_id', '=', id)
        .orderBy('m.created_at', 'desc')
        .execute();
      return {
        ...(await this.summary(trx, auth.officeId, c)),
        npwpMasked: maskId(await this.crypto.decrypt(trx, auth.officeId, c.npwp_enc)),
        birthDate: c.birth_date,
        hasAddress: !!c.address_enc,
        matters,
      };
    });
  }

  /**
   * Buka NIK/NPWP/alamat lengkap. Selalu dicatat di audit.
   * Tanpa `matter.read_all`, staf hanya bisa membuka klien yang menjadi pihak di berkas yang ditugaskan kepadanya.
   */
  @Can('client.reveal')
  @Post(':id/reveal')
  @HttpCode(200)
  reveal(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.dbs.as(auth, async (trx) => {
      const c = await trx.selectFrom('clients').selectAll().where('id', '=', id).executeTakeFirst();
      if (!c) throw NotFound('Klien');
      if (!auth.permissions.has('matter.read_all')) {
        const link = await trx
          .selectFrom('matter_parties as p')
          .innerJoin('matter_assignments as a', 'a.matter_id', 'p.matter_id')
          .select('p.matter_id')
          .where('p.client_id', '=', id)
          .where('a.user_id', '=', auth.userId!)
          .executeTakeFirst();
        if (!link) {
          throw new AppError('MATTER_NOT_ASSIGNED', 'Klien ini tidak terkait berkas yang ditugaskan kepada Anda', 403).withAudit({
            action: 'access.denied',
            entity: 'client',
            entityId: id,
            detail: { reason: 'reveal_not_assigned' },
          });
        }
      }
      await writeAudit(trx, auth, { action: 'client.revealed', entity: 'client', entityId: id });
      return {
        nik: await this.crypto.decrypt(trx, auth.officeId, c.nik_enc),
        npwp: await this.crypto.decrypt(trx, auth.officeId, c.npwp_enc),
        address: await this.crypto.decrypt(trx, auth.officeId, c.address_enc),
      };
    });
  }

  private async summary(
    trx: Trx,
    officeId: string,
    r: { id: string; type: string; full_name: string; nik_enc: Buffer | null; phone: string | null; email: string | null; kyc_risk: string | null; created_at: Date },
  ) {
    return {
      id: r.id,
      type: r.type,
      fullName: r.full_name,
      nikMasked: maskId(await this.crypto.decrypt(trx, officeId, r.nik_enc)),
      phone: r.phone,
      email: r.email,
      kycRisk: r.kyc_risk,
      createdAt: r.created_at,
    };
  }
}

// Dipakai modul lain untuk memastikan klien ada di kantor yang sama (RLS).
export async function clientExists(trx: Trx, id: string) {
  const r = await trx.selectFrom('clients').select(sql<number>`1`.as('x')).where('id', '=', id).executeTakeFirst();
  return !!r;
}
