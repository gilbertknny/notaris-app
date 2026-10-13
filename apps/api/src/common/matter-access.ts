import type { AuthContext } from './auth/auth-context';
import type { Trx } from './db.service';
import { AppError, NotFound } from './errors';

/**
 * Izin berkas: staf hanya boleh menyentuh berkas yang ditugaskan kepadanya.
 * Pemegang `matter.read_all` (Notaris) melewati cek ini.
 * Klien hanya bisa melihat berkas di mana ia menjadi pihak.
 * Penolakan dicatat di audit_log (lihat DbService.as).
 */
export async function assertMatterAccess(trx: Trx, auth: AuthContext, matterId: string) {
  const matter = await trx.selectFrom('matters').selectAll().where('id', '=', matterId).executeTakeFirst();
  if (!matter) throw NotFound('Berkas');

  if (auth.kind === 'client') {
    const party = await trx
      .selectFrom('matter_parties')
      .select('client_id')
      .where('matter_id', '=', matterId)
      .where('client_id', '=', auth.clientId!)
      .executeTakeFirst();
    if (!party) throw NotFound('Berkas');
    return matter;
  }

  if (auth.permissions.has('matter.read_all')) return matter;

  const assigned = await trx
    .selectFrom('matter_assignments')
    .select('user_id')
    .where('matter_id', '=', matterId)
    .where('user_id', '=', auth.userId!)
    .executeTakeFirst();
  if (!assigned) {
    throw new AppError('MATTER_NOT_ASSIGNED', 'Anda tidak ditugaskan pada berkas ini', 403).withAudit({
      action: 'access.denied',
      entity: 'matter',
      entityId: matterId,
      detail: { reason: 'not_assigned' },
    });
  }
  return matter;
}
