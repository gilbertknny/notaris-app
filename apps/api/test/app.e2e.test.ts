import type { INestApplication } from '@nestjs/common';
import { authenticator } from 'otplib';
import request from 'supertest';
import { sql } from 'kysely';
import { CSRF, dropTestDb, prepareTestEnv, SAMPLE_PDF } from './helpers';

/**
 * Skenario wajib dari rancangan (tab Backend → Error, logging, dan pengujian):
 * - akses berkas yang tidak ditugaskan ditolak dan diaudit
 * - nomor akta tidak ganda saat banyak permintaan bersamaan
 * - RLS mencegah data lintas kantor
 * plus alur lengkap draf → persetujuan → nomor akta, portal klien, dan pemindaian dokumen.
 */
describe('Aplikasi Notaris (e2e)', () => {
  let env: Awaited<ReturnType<typeof prepareTestEnv>>;
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let secrets: Record<string, string>;
  let officeA: string;
  let officeB: string;
  let secretsB: Record<string, string>;
  // Modul aplikasi dimuat setelah env disiapkan (config dibaca saat impor).
  let mods: {
    DbService: typeof import('../src/common/db.service').DbService;
    takeNextNumber: typeof import('../src/modules/registry/registry.controller').takeNextNumber;
    OutboxProcessor: typeof import('../src/worker/outbox.processor').OutboxProcessor;
    StorageService: typeof import('../src/modules/documents/storage.service').StorageService;
  };

  beforeAll(async () => {
    env = await prepareTestEnv();
    const { migrate } = await import('../src/db/migrate');
    const { seed } = await import('../src/db/seed');
    await migrate(env.migratorUrl, env.appPw, () => undefined);
    const a = await seed(env.migratorUrl, { quiet: true });
    const b = await seed(env.migratorUrl, { quiet: true, officeName: 'Kantor B' });
    officeA = a.officeId;
    officeB = b.officeId;
    secrets = a.secrets;
    secretsB = b.secrets;

    const { createApp } = await import('../src/bootstrap');
    mods = {
      DbService: (await import('../src/common/db.service')).DbService,
      takeNextNumber: (await import('../src/modules/registry/registry.controller')).takeNextNumber,
      OutboxProcessor: (await import('../src/worker/outbox.processor')).OutboxProcessor,
      StorageService: (await import('../src/modules/documents/storage.service')).StorageService,
    };
    app = await createApp({ logger: false });
    await app.init();
    http = app.getHttpServer();
    const { RedisService } = await import('../src/common/redis.service');
    await app.get(RedisService).client.flushdb();
  });

  afterAll(async () => {
    await app?.close();
    if (env) await dropTestDb(env.admin, env.dbName);
  });

  /** Login staf penuh (kata sandi + TOTP), kembalikan agent ber-cookie. */
  async function loginAs(email: string, secretMap = secrets) {
    const agent = request.agent(http);
    await agent.post('/api/v1/auth/login').set(CSRF).send({ email, password: 'Notaris#2026demo' }).expect(200);
    await agent.post('/api/v1/auth/mfa/verify').set(CSRF).send({ code: authenticator.generate(secretMap[email]) }).expect(200);
    return agent;
  }

  async function worker() {
    const dbs = app.get(mods.DbService);
    return new mods.OutboxProcessor(dbs, new mods.StorageService()).drain();
  }

  describe('autentikasi', () => {
    it('menolak kata sandi salah dengan pesan generik', async () => {
      const res = await request(http).post('/api/v1/auth/login').set(CSRF).send({ email: 'admin@contoh.id', password: 'salah' }).expect(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
      const unknown = await request(http).post('/api/v1/auth/login').set(CSRF).send({ email: 'tidakada@contoh.id', password: 'salah' }).expect(401);
      expect(unknown.body.message).toBe(res.body.message);
    });

    it('memblokir setelah 5 percobaan gagal', async () => {
      for (let i = 0; i < 5; i++) {
        await request(http).post('/api/v1/auth/login').set(CSRF).send({ email: 'sysadmin@contoh.id', password: 'salah' });
      }
      const res = await request(http).post('/api/v1/auth/login').set(CSRF).send({ email: 'sysadmin@contoh.id', password: 'Notaris#2026demo' }).expect(429);
      expect(res.body.code).toBe('TOO_MANY_ATTEMPTS');
    });

    it('kata sandi benar saja belum membuka data: MFA wajib', async () => {
      const agent = request.agent(http);
      await agent.post('/api/v1/auth/login').set(CSRF).send({ email: 'admin@contoh.id', password: 'Notaris#2026demo' }).expect(200);
      const res = await agent.get('/api/v1/matters').expect(401);
      expect(res.body.code).toBe('MFA_REQUIRED');
      await agent.post('/api/v1/auth/mfa/verify').set(CSRF).send({ code: '000000' }).expect(401);
    });

    it('menolak mutasi tanpa header CSRF', async () => {
      const res = await request(http).post('/api/v1/auth/login').send({ email: 'admin@contoh.id', password: 'x' }).expect(403);
      expect(res.body.code).toBe('CSRF');
    });

    it('logout mencabut sesi di server', async () => {
      const agent = await loginAs('admin@contoh.id');
      await agent.get('/api/v1/auth/me').expect(200);
      await agent.post('/api/v1/auth/logout').set(CSRF).expect(200);
      await agent.get('/api/v1/auth/me').expect(401);
    });
  });

  describe('izin peran & izin berkas', () => {
    it('staf hanya melihat berkas yang ditugaskan', async () => {
      const drafter = await loginAs('drafter@contoh.id');
      const notaris = await loginAs('notaris@contoh.id');
      const mine = (await drafter.get('/api/v1/matters').expect(200)).body;
      const all = (await notaris.get('/api/v1/matters').expect(200)).body;
      expect(mine).toHaveLength(1);
      expect(all).toHaveLength(2);
    });

    it('membuka berkas yang tidak ditugaskan ditolak dan tercatat di audit', async () => {
      const notaris = await loginAs('notaris@contoh.id');
      const all = (await notaris.get('/api/v1/matters').expect(200)).body as { id: string; code: string }[];
      const other = all.find((m) => m.code.endsWith('0002'))!;
      const drafter = await loginAs('drafter@contoh.id');
      const res = await drafter.get(`/api/v1/matters/${other.id}`).expect(403);
      expect(res.body.code).toBe('MATTER_NOT_ASSIGNED');

      const log = (await notaris.get('/api/v1/audit-logs?action=access.denied').expect(200)).body as { entityId: string }[];
      expect(log.some((l) => l.entityId === other.id)).toBe(true);
    });

    it('staf keuangan tidak bisa membuat klien', async () => {
      const keu = await loginAs('keuangan@contoh.id');
      const res = await keu.post('/api/v1/clients').set(CSRF).send({ type: 'company', fullName: 'PT X' }).expect(403);
      expect(res.body.details.missing).toContain('client.write');
    });

    it('NIK tersamar di daftar dan hanya terbuka lewat aksi yang diaudit', async () => {
      const admin = await loginAs('admin@contoh.id');
      const created = (
        await admin.post('/api/v1/clients').set(CSRF).send({ type: 'person', fullName: 'Lina Marlina', nik: '3171014403900009', address: 'Jl. Melati 1' }).expect(201)
      ).body;
      expect(created.nikMasked).toBe('3171********0009');
      const dup = await admin.post('/api/v1/clients').set(CSRF).send({ type: 'person', fullName: 'Lina M', nik: '3171014403900009' }).expect(409);
      expect(dup.body.code).toBe('CLIENT_DUPLICATE');
      const found = (await admin.get('/api/v1/clients?q=3171014403900009').expect(200)).body;
      expect(found[0].id).toBe(created.id);

      // Admin kantor tanpa read_all: klien belum terkait berkas yang ditugaskan → ditolak.
      await admin.post(`/api/v1/clients/${created.id}/reveal`).set(CSRF).expect(403);
      const notaris = await loginAs('notaris@contoh.id');
      const revealed = (await notaris.post(`/api/v1/clients/${created.id}/reveal`).set(CSRF).expect(200)).body;
      expect(revealed.nik).toBe('3171014403900009');

      // Di database, NIK tersimpan terenkripsi (bukan teks biasa).
      const dbs = app.get(mods.DbService);
      const raw = await dbs.tx({ officeId: officeA }, (trx) => trx.selectFrom('clients').select('nik_enc').where('id', '=', created.id).executeTakeFirstOrThrow());
      expect(raw.nik_enc!.toString('latin1')).not.toContain('3171014403900009');
    });
  });

  describe('alur akta: draf → persetujuan → nomor', () => {
    let matterId: string;
    let draftId: string;

    it('drafter menyusun draf dari template', async () => {
      const drafter = await loginAs('drafter@contoh.id');
      matterId = (await drafter.get('/api/v1/matters').expect(200)).body[0].id;
      const templates = (await drafter.get('/api/v1/templates?serviceType=ajb').expect(200)).body;
      const res = await drafter.post(`/api/v1/matters/${matterId}/drafts`).set(CSRF).send({ templateId: templates[0].id }).expect(201);
      draftId = res.body.id;
      const draft = (await drafter.get(`/api/v1/drafts/${draftId}`).expect(200)).body;
      expect(draft.content).toContain('Hendra Wijaya');
      expect(draft.content).toContain('[[harga]]');
    });

    it('draf dengan isian kosong tidak bisa dikirim', async () => {
      const drafter = await loginAs('drafter@contoh.id');
      const res = await drafter.post(`/api/v1/drafts/${draftId}/submit`).set(CSRF).expect(422);
      expect(res.body.code).toBe('DRAFT_INCOMPLETE');
    });

    it('drafter melengkapi dan mengirim; drafter tidak bisa menyetujui', async () => {
      const drafter = await loginAs('drafter@contoh.id');
      const draft = (await drafter.get(`/api/v1/drafts/${draftId}`).expect(200)).body;
      const filled = draft.content.replace(/\[\[[^\]]+\]\]/g, 'diisi');
      await drafter.put(`/api/v1/drafts/${draftId}`).set(CSRF).send({ content: filled }).expect(200);
      await drafter.post(`/api/v1/drafts/${draftId}/submit`).set(CSRF).expect(200);
      await drafter.post(`/api/v1/drafts/${draftId}/approve`).set(CSRF).expect(403);
      const m = (await drafter.get(`/api/v1/matters/${matterId}`).expect(200)).body;
      expect(m.status).toBe('review');
    });

    it('status tidak bisa dilompati lewat transisi manual', async () => {
      const notaris = await loginAs('notaris@contoh.id');
      const res = await notaris.post(`/api/v1/matters/${matterId}/transition`).set(CSRF).send({ to: 'scheduled' }).expect(409);
      expect(res.body.code).toBe('INVALID_TRANSITION');
    });

    it('Notaris menyetujui lalu memberi nomor akta', async () => {
      const notaris = await loginAs('notaris@contoh.id');
      const queue = (await notaris.get('/api/v1/approvals').expect(200)).body;
      expect(queue.map((q: { id: string }) => q.id)).toContain(draftId);
      await notaris.post(`/api/v1/drafts/${draftId}/approve`).set(CSRF).expect(200);
      const deed = (await notaris.post(`/api/v1/matters/${matterId}/deeds`).set(CSRF).send({ register: 'ppat', title: 'Akta Jual Beli' }).expect(201)).body;
      expect(deed.number).toBe(1);
      const m = (await notaris.get(`/api/v1/matters/${matterId}`).expect(200)).body;
      expect(m.status).toBe('signed');
      expect(m.deeds).toHaveLength(1);
      // Tidak bisa dibatalkan setelah bernomor.
      await notaris.post(`/api/v1/matters/${matterId}/transition`).set(CSRF).send({ to: 'cancelled' }).expect(409);

      const month = String(deed.period).slice(0, 7);
      const reg = (await notaris.get(`/api/v1/registers/ppat?month=${month}`).expect(200)).body;
      expect(reg.entries[0].number).toBe(1);
      const csv = await notaris.get(`/api/v1/registers/ppat/export?month=${month}`).expect(200);
      expect(csv.text).toContain('Akta Jual Beli');
    });

    it('aksi sensitif meminta MFA ulang bila MFA terakhir sudah lama', async () => {
      const notaris = await loginAs('notaris@contoh.id');
      const dbs = app.get(mods.DbService);
      await dbs.db.updateTable('sessions').set({ mfa_verified_at: new Date(Date.now() - 60 * 60_000) }).where('revoked_at', 'is', null).execute();
      const res = await notaris.post('/api/v1/registers/ppat/2026-01/lock').set(CSRF).expect(401);
      expect(res.body.code).toBe('MFA_REAUTH_REQUIRED');
      await notaris.post('/api/v1/auth/mfa/verify').set(CSRF).send({ code: authenticator.generate(secrets['notaris@contoh.id']) }).expect(200);
      await notaris.post('/api/v1/registers/ppat/2026-01/lock').set(CSRF).expect(200);
    });

    it('event pasca-COMMIT diproses worker (notifikasi ke pihak)', async () => {
      await worker();
      const dbs = app.get(mods.DbService);
      const sent = await dbs.db.selectFrom('notifications').select(['template', 'recipient']).where('template', '=', 'deed_signed').execute();
      expect(sent.map((s) => s.recipient)).toEqual(expect.arrayContaining(['klien@contoh.id', 'maria@contoh.id']));
    });
  });

  describe('penomoran akta', () => {
    it('50 permintaan bersamaan menghasilkan nomor 1..50 tanpa ganda atau loncat', async () => {
      const dbs = app.get(mods.DbService);
      const numbers = await Promise.all(
        Array.from({ length: 50 }, () => dbs.tx({ officeId: officeA }, (trx) => mods.takeNextNumber(trx, officeA, 'legalisasi', '2026-03-01'))),
      );
      expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    });

    it('transaksi yang gagal tidak memakan nomor', async () => {
      const dbs = app.get(mods.DbService);
      await expect(
        dbs.tx({ officeId: officeA }, async (trx) => {
          await mods.takeNextNumber(trx, officeA, 'waarmerking', '2026-03-01');
          throw new Error('batal');
        }),
      ).rejects.toThrow('batal');
      const n = await dbs.tx({ officeId: officeA }, (trx) => mods.takeNextNumber(trx, officeA, 'waarmerking', '2026-03-01'));
      expect(n).toBe(1);
    });

    it('bulan yang sudah dikunci menolak nomor baru', async () => {
      const dbs = app.get(mods.DbService);
      await expect(dbs.tx({ officeId: officeA }, (trx) => mods.takeNextNumber(trx, officeA, 'ppat', '2026-01-01'))).rejects.toMatchObject({ code: 'PERIOD_LOCKED' });
    });
  });

  describe('row-level security', () => {
    it('kantor B tidak bisa melihat data kantor A', async () => {
      const dbs = app.get(mods.DbService);
      const fromB = await dbs.tx({ officeId: officeB }, (trx) => trx.selectFrom('matters').select('office_id').execute());
      expect(fromB.length).toBeGreaterThan(0);
      expect(fromB.every((m) => m.office_id === officeB)).toBe(true);

      const agentB = await loginAs(Object.keys(secretsB).find((e) => e.startsWith('notaris'))!, secretsB);
      const fromA = (await request(http).get('/api/v1/matters')).status;
      expect(fromA).toBe(401);
      const listB = (await agentB.get('/api/v1/matters').expect(200)).body as { id: string }[];
      const idsA = await dbs.tx({ officeId: officeA }, (trx) => trx.selectFrom('matters').select('id').execute());
      expect(listB.some((m) => idsA.some((a) => a.id === m.id))).toBe(false);
      await agentB.get(`/api/v1/matters/${idsA[0].id}`).expect(404);
    });

    it('tanpa app.office_id, tabel bisnis kosong; audit_log tidak bisa diubah', async () => {
      const dbs = app.get(mods.DbService);
      const rows = await dbs.db.selectFrom('clients').select('id').execute();
      expect(rows).toHaveLength(0);
      await expect(
        dbs.tx({ officeId: officeA }, (trx) => sql`update audit_log set action = 'x'`.execute(trx)),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('portal klien & dokumen', () => {
    it('klien masuk dengan OTP, melihat berkasnya, dan mengunggah dokumen', async () => {
      const client = request.agent(http);
      await client.post('/api/v1/portal/auth/otp').set(CSRF).send({ email: 'maria@contoh.id' }).expect(200);
      // Email tak terdaftar mendapat respons yang sama.
      const unknown = await request(http).post('/api/v1/portal/auth/otp').set(CSRF).send({ email: 'x@y.id' }).expect(200);
      expect(unknown.body.ok).toBe(true);

      await worker();
      const dbs = app.get(mods.DbService);
      const note = await dbs.db
        .selectFrom('notifications')
        .select('body')
        .where('template', '=', 'portal_otp')
        .where('recipient', '=', 'maria@contoh.id')
        .orderBy('id', 'desc')
        .executeTakeFirstOrThrow();
      const code = note.body.match(/\d{6}/)![0];
      await client.post('/api/v1/portal/auth/verify').set(CSRF).send({ email: 'maria@contoh.id', code: '000000' === code ? '111111' : '000000' }).expect(401);
      await client.post('/api/v1/portal/auth/verify').set(CSRF).send({ email: 'maria@contoh.id', code }).expect(200);

      const matters = (await client.get('/api/v1/portal/matters').expect(200)).body;
      expect(matters).toHaveLength(2);
      const open = matters.find((m: { status: string }) => m.status === 'documents');
      expect(open.nextStep).toMatch(/dokumen/);

      // Sesi klien tidak bisa membuka API staf.
      await client.get('/api/v1/matters').expect(401);

      const ok = await client.post(`/api/v1/portal/matters/${open.id}/documents`).set(CSRF).field('kind', 'ktp').attach('file', SAMPLE_PDF, { filename: 'ktp.pdf', contentType: 'application/pdf' }).expect(201);
      expect(ok.body.status).toBe('pending_scan');
      const fake = await client
        .post(`/api/v1/portal/matters/${open.id}/documents`)
        .set(CSRF)
        .field('kind', 'npwp')
        .attach('file', Buffer.from('MZ bukan pdf'), { filename: 'npwp.pdf', contentType: 'application/pdf' })
        .expect(201);
      await client.post(`/api/v1/portal/matters/${open.id}/documents`).set(CSRF).field('kind', 'ktp').attach('file', Buffer.from('x'), { filename: 'a.exe', contentType: 'application/x-msdownload' }).expect(415);

      await worker();
      const docs = await dbs.tx({ officeId: officeA }, (trx) => trx.selectFrom('documents').select(['id', 'status']).where('id', 'in', [ok.body.id, fake.body.id]).execute());
      expect(docs.find((d) => d.id === ok.body.id)!.status).toBe('ready');
      expect(docs.find((d) => d.id === fake.body.id)!.status).toBe('quarantined');

      // Staf yang ditugaskan mengunduh lewat link bertanda tangan.
      const drafter2 = await loginAs('drafter2@contoh.id');
      const link = (await drafter2.get(`/api/v1/documents/${ok.body.id}/link`).expect(200)).body;
      const file = await request(http).get(link.url).expect(200);
      expect(Buffer.from(file.body).subarray(0, 5).toString()).toBe('%PDF-');
      await drafter2.get(`/api/v1/documents/${fake.body.id}/link`).expect(409);
      await request(http).get(link.url.slice(0, -3) + 'abc').expect(410);
    });
  });
});
