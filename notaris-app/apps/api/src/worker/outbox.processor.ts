import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { DbService, Trx } from '../common/db.service';
import { StorageService, sniffMime } from '../modules/documents/storage.service';

const MAX_ATTEMPTS = 5;
type Event = { id: string; office_id: string; topic: string; payload: Record<string, unknown>; attempts: number };

/**
 * Memproses event outbox satu per satu dengan FOR UPDATE SKIP LOCKED,
 * sehingga beberapa worker bisa berjalan paralel tanpa memproses event yang sama.
 * Kegagalan di sini tidak pernah membatalkan transaksi bisnis yang sudah COMMIT (mis. nomor akta).
 */
export class OutboxProcessor {
  private readonly logger = new Logger('Worker');

  constructor(
    private readonly dbs: DbService,
    private readonly storage: StorageService,
  ) {}

  /** Proses sampai antrean kosong atau `max` event; kembalikan jumlah yang diproses. */
  async drain(max = 100): Promise<number> {
    let n = 0;
    while (n < max && (await this.processOne())) n++;
    return n;
  }

  async processOne(): Promise<boolean> {
    return this.dbs.db.transaction().execute(async (trx) => {
      const ev = (await trx
        .selectFrom('outbox')
        .select(['id', 'office_id', 'topic', 'payload', 'attempts'])
        .where('processed_at', 'is', null)
        .where('available_at', '<=', new Date())
        .orderBy('id')
        .limit(1)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst()) as Event | undefined;
      if (!ev) return false;
      try {
        await sql`select set_config('app.office_id', ${ev.office_id}, true)`.execute(trx);
        await this.handle(trx, ev);
        await trx.updateTable('outbox').set({ processed_at: new Date(), attempts: ev.attempts + 1 }).where('id', '=', ev.id).execute();
      } catch (err) {
        const attempts = ev.attempts + 1;
        const msg = (err as Error).message.slice(0, 500);
        this.logger.warn(`Event ${ev.id} (${ev.topic}) gagal [${attempts}/${MAX_ATTEMPTS}]: ${msg}`);
        await trx
          .updateTable('outbox')
          .set({
            attempts,
            last_error: attempts >= MAX_ATTEMPTS ? `DEAD: ${msg}` : msg,
            processed_at: attempts >= MAX_ATTEMPTS ? new Date() : null,
            available_at: new Date(Date.now() + 2 ** attempts * 1000),
          })
          .where('id', '=', ev.id)
          .execute();
      }
      return true;
    });
  }

  private async handle(trx: Trx, ev: Event) {
    const p = ev.payload;
    switch (ev.topic) {
      case 'document.uploaded':
        return this.scanDocument(trx, ev.office_id, String(p.documentId));
      case 'notification.send':
        return this.notify(trx, ev.office_id, String(p.channel), String(p.recipient), String(p.template), String(p.body));
      case 'deed.numbered':
        return this.notifyParties(trx, ev.office_id, String(p.matterId), 'deed_signed', (code) => `Akta untuk berkas ${code} sudah ditandatangani dan diberi nomor.`);
      case 'appointment.created': {
        const appt = await trx.selectFrom('appointments').select(['starts_at', 'room']).where('id', '=', String(p.appointmentId)).executeTakeFirst();
        if (!appt) return;
        const when = appt.starts_at.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'full', timeStyle: 'short' });
        return this.notifyParties(trx, ev.office_id, String(p.matterId), 'appointment', (code) => `Jadwal penandatanganan berkas ${code}: ${when}${appt.room ? `, ruang ${appt.room}` : ''}.`);
      }
      case 'draft.submitted':
        return this.notifyNotary(trx, ev.office_id, String(p.matterId), 'Draf baru menunggu persetujuan Anda.');
      default:
        // Event lain (matter.created, matter.status_changed, ...) cukup ditandai selesai;
        // tempat integrasi lanjutan (AHU, BPN, pembayaran) dipasang nanti.
        return;
    }
  }

  /** Pemeriksaan dasar: tanda tangan file harus cocok dengan tipe yang diizinkan. Tempat memasang ClamAV. */
  private async scanDocument(trx: Trx, officeId: string, documentId: string) {
    const doc = await trx.selectFrom('documents').selectAll().where('id', '=', documentId).executeTakeFirst();
    if (!doc || doc.status !== 'pending_scan') return;
    const data = await this.storage.read(doc.storage_key);
    const sniffed = sniffMime(data);
    const sameHash = createHash('sha256').update(data).digest().equals(doc.sha256);
    if (!sniffed || sniffed !== doc.mime || !sameHash) {
      const key = await this.storage.quarantine(doc.storage_key);
      await trx.updateTable('documents').set({ status: 'quarantined', storage_key: key }).where('id', '=', doc.id).execute();
      await trx
        .insertInto('audit_log')
        .values({ office_id: officeId, actor_type: 'system', actor_id: null, action: 'document.quarantined', entity: 'matter', entity_id: doc.matter_id, ip: null, detail: JSON.stringify({ documentId: doc.id, sniffed, declared: doc.mime }) })
        .execute();
      return;
    }
    await trx.updateTable('documents').set({ status: 'ready' }).where('id', '=', doc.id).execute();
    if (doc.uploaded_by_client && doc.matter_id) {
      await this.notifyAssignees(trx, officeId, doc.matter_id, 'Klien mengunggah dokumen baru.');
    }
  }

  private async notify(trx: Trx, officeId: string, channel: string, recipient: string, template: string, body: string) {
    // Adapter WhatsApp/email produksi dipasang di sini. Pengembangan: dicatat di tabel notifications.
    await trx.insertInto('notifications').values({ office_id: officeId, channel, recipient, template, body }).execute();
    this.logger.log(`[${channel}] → ${recipient}: ${template}`);
  }

  private async notifyParties(trx: Trx, officeId: string, matterId: string, template: string, text: (code: string) => string) {
    const matter = await trx.selectFrom('matters').select('code').where('id', '=', matterId).executeTakeFirst();
    if (!matter) return;
    const parties = await trx
      .selectFrom('matter_parties as p')
      .innerJoin('clients as c', 'c.id', 'p.client_id')
      .select(['c.email', 'c.phone'])
      .where('p.matter_id', '=', matterId)
      .execute();
    for (const party of parties) {
      if (party.email) await this.notify(trx, officeId, 'email', party.email, template, text(matter.code));
      else if (party.phone) await this.notify(trx, officeId, 'whatsapp', party.phone, template, text(matter.code));
    }
  }

  private async notifyAssignees(trx: Trx, officeId: string, matterId: string, text: string) {
    const users = await trx
      .selectFrom('matter_assignments as a')
      .innerJoin('users as u', 'u.id', 'a.user_id')
      .select('u.email')
      .where('a.matter_id', '=', matterId)
      .execute();
    for (const u of users) await this.notify(trx, officeId, 'app', u.email, 'staff_alert', text);
  }

  private async notifyNotary(trx: Trx, officeId: string, matterId: string, text: string) {
    const notaries = await trx
      .selectFrom('users as u')
      .innerJoin('roles as r', 'r.id', 'u.role_id')
      .select('u.email')
      .where('u.office_id', '=', officeId)
      .where(sql<boolean>`'draft.approve' = any(r.permissions)`)
      .where('u.active', '=', true)
      .execute();
    const matter = await trx.selectFrom('matters').select('code').where('id', '=', matterId).executeTakeFirst();
    for (const n of notaries) await this.notify(trx, officeId, 'app', n.email, 'approval_needed', `${text} (${matter?.code ?? ''})`);
  }
}
