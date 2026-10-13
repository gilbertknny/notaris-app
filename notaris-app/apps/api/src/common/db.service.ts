import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Kysely, sql, Transaction } from 'kysely';
import type { DB } from '../db/schema';
import { createDb } from '../db/connection';
import { config } from '../config';
import type { AuthContext } from './auth/auth-context';
import { AppError } from './errors';

export type Trx = Transaction<DB>;

@Injectable()
export class DbService implements OnModuleDestroy {
  /** Koneksi role `notaris_app`: semua tabel bisnis tunduk RLS per kantor. */
  readonly db: Kysely<DB> = createDb(config().DATABASE_URL);

  /**
   * Jalankan fn di dalam transaksi dengan `app.office_id` terpasang (SET LOCAL).
   * Tanpa ini, RLS mengembalikan nol baris untuk semua tabel bisnis.
   */
  async tx<T>(scope: { officeId: string; actorId?: string | null }, fn: (trx: Trx) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.office_id', ${scope.officeId}, true), set_config('app.actor_id', ${scope.actorId ?? ''}, true)`.execute(trx);
      return fn(trx);
    });
  }

  /**
   * Transaksi untuk konteks login (staf atau klien).
   * Bila gagal dengan AppError yang membawa entri audit (mis. akses ditolak),
   * entri itu ditulis di transaksi terpisah agar tidak ikut ter-rollback.
   */
  async as<T>(auth: AuthContext, fn: (trx: Trx) => Promise<T>): Promise<T> {
    const scope = { officeId: auth.officeId, actorId: auth.kind === 'staff' ? auth.userId : null };
    try {
      return await this.tx(scope, fn);
    } catch (err) {
      if (err instanceof AppError && err.audit) {
        const entry = err.audit;
        await this.tx(scope, (trx) => writeAudit(trx, auth, entry)).catch(() => undefined);
      }
      throw err;
    }
  }

  async onModuleDestroy() {
    await this.db.destroy();
  }
}

export async function writeAudit(
  trx: Trx,
  auth: Pick<AuthContext, 'officeId' | 'kind' | 'userId' | 'clientId' | 'ip'> | null,
  entry: { officeId?: string; action: string; entity: string; entityId?: string | null; detail?: Record<string, unknown> },
) {
  await trx
    .insertInto('audit_log')
    .values({
      office_id: entry.officeId ?? auth!.officeId,
      actor_type: auth ? auth.kind : 'system',
      actor_id: auth ? (auth.kind === 'staff' ? auth.userId : auth.clientId) ?? null : null,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      ip: auth?.ip ?? null,
      detail: entry.detail ? JSON.stringify(entry.detail) : null,
    })
    .execute();
}

/** Tulis event ke outbox di transaksi yang sama dengan perubahan data. */
export async function emit(trx: Trx, officeId: string, topic: string, payload: Record<string, unknown>) {
  await trx.insertInto('outbox').values({ office_id: officeId, topic, payload: JSON.stringify(payload) }).execute();
}
