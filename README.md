# Aplikasi Kantor Notaris & PPAT — MVP

Aplikasi web untuk mengelola siklus berkas kantor Notaris/PPAT: penerimaan klien → dokumen → draf akta → persetujuan Notaris → penandatanganan & nomor akta → buku daftar → laporan, plus portal klien. Kode ini mengikuti dokumen rancangan (tab Arsitektur, Backend, Frontend, Database, Security, Diagram UML).

> **Status:** MVP yang bisa dijalankan dan sudah diuji otomatis. Belum siap produksi tanpa langkah di bagian [Sebelum dipakai sungguhan](#sebelum-dipakai-sungguhan). Template akta di dalamnya hanya **contoh** dan wajib divalidasi Notaris.

## Isi

| Area | Yang sudah jalan |
| --- | --- |
| Login staf | Kata sandi (Argon2id) + MFA TOTP wajib, batas 5 percobaan, sesi server-side di cookie `HttpOnly; SameSite=Strict`, logout mencabut sesi, MFA ulang untuk aksi sensitif |
| Hak akses | Peran (Notaris, drafter, administrasi, keuangan, admin sistem) + izin per berkas (staf hanya melihat berkas yang ditugaskan) + row-level security PostgreSQL per kantor |
| Klien | NIK/NPWP/alamat dienkripsi AES-256-GCM (envelope encryption), pencarian NIK lewat HMAC, NIK tersamar di layar, "Tampilkan" tercatat di audit |
| Berkas | Nomor berkas otomatis, pihak & peran, penugasan staf, status mengikuti state diagram (tidak bisa dilompati) |
| Draf akta | Template dengan isian otomatis (`{{party.penjual.name}}`, tanggal dengan huruf), isian kosong ditandai `[[...]]` dan memblokir pengiriman, versi, kirim → setujui/kembalikan |
| Penomoran akta | Nomor diambil dalam transaksi yang sama dengan entri buku daftar; diuji 50 permintaan paralel tanpa nomor ganda/loncat; bulan bisa dikunci |
| Buku daftar | Repertorium, Akta PPAT, Legalisasi, Waarmerking per bulan, ekspor CSV |
| Dokumen | Unggah staf/klien, cek tipe file dari isi (magic bytes) oleh worker, karantina file mencurigakan, link unduh bertanda tangan 15 menit |
| Jadwal, keuangan, laporan | Jadwal tanda tangan + cek bentrok ruang, tagihan + titipan pajak + pembayaran, laporan bulanan |
| Portal klien | Login OTP email (tanpa kata sandi), lihat status berkas & tagihan, unggah dokumen dari ponsel |
| Audit & worker | Log audit append-only (UPDATE/DELETE dicabut di database), riwayat perubahan otomatis via trigger, outbox + worker untuk notifikasi & pemindaian |

## Menjalankan dengan Docker (paling cepat)

```bash
cp .env.example .env
# Ganti dua kunci rahasia:
#   KMS_MASTER_KEY=$(openssl rand -base64 32)
#   HMAC_KEY=$(openssl rand -base64 32)
# dan APP_DB_PASSWORD dengan password acak.
docker compose up --build
```

Buka **http://localhost:3000** (kantor) dan **http://localhost:3000/portal/login** (klien).

Akun demo (kata sandi semua: `Notaris#2026demo`, MFA sudah aktif):

| Email | Peran |
| --- | --- |
| notaris@contoh.id | Notaris/PPAT (semua izin) |
| drafter@contoh.id, drafter2@contoh.id | Staf akta |
| admin@contoh.id | Administrasi |
| keuangan@contoh.id | Keuangan |
| sysadmin@contoh.id | Admin sistem |

Kode MFA demo: `docker compose exec api node dist/db/dev-otp.js notaris@contoh.id`, atau masukkan secret yang dicetak di `docker compose logs migrate` ke Google/Microsoft Authenticator.
Portal klien: masuk dengan `klien@contoh.id` atau `maria@contoh.id`; kode OTP tercetak di `docker compose logs api` (mode development).

## Pengembangan lokal

Butuh Node 20+, pnpm 10, PostgreSQL 16, Redis 7.

```bash
pnpm install
cp .env.example .env          # isi kunci, sesuaikan DATABASE_URL_MIGRATOR
createdb notaris
pnpm --filter @notaris/shared build
pnpm --filter @notaris/api build
pnpm db:migrate && pnpm db:seed
pnpm dev:api       # http://localhost:4000/api/v1
pnpm dev:worker
pnpm dev:web       # http://localhost:3000
pnpm --filter @notaris/api otp drafter@contoh.id   # kode MFA demo
```

## Pengujian

```bash
pnpm --filter @notaris/shared build && pnpm --filter @notaris/shared test   # aturan domain
pnpm --filter @notaris/api test                                            # unit + e2e (PostgreSQL & Redis sungguhan)
```

Test e2e membuat database sementara sendiri (`TEST_PG_ADMIN_URL`, default `postgresql://postgres:postgres@localhost:5432/postgres`) dan memakai Redis DB 15. Skenario yang diuji, antara lain:

- kata sandi benar tanpa MFA tidak membuka data; brute-force diblokir; mutasi tanpa header CSRF ditolak
- staf tidak bisa membuka berkas yang tidak ditugaskan, dan penolakan tercatat di audit
- NIK tidak tersimpan sebagai teks biasa di database
- alur lengkap draf → kirim → setujui (MFA ulang) → nomor akta → buku daftar → CSV
- 50 permintaan nomor akta paralel menghasilkan 1..50; transaksi gagal tidak memakan nomor; bulan terkunci menolak nomor
- kantor B tidak melihat data kantor A; tanpa konteks kantor, tabel bisnis kosong; `audit_log` tidak bisa di-UPDATE
- portal: OTP, akses hanya berkas sendiri, unggah PDF valid → siap, file palsu → karantina, link unduh kedaluwarsa ditolak

## Struktur

```text
packages/shared/     aturan domain & skema validasi Zod (dipakai API dan web)
apps/api/            NestJS + Kysely (SQL eksplisit) + PostgreSQL + Redis
  db/migrations/     001_schema.sql, 002_rls.sql (RLS, hak akses, trigger audit)
  src/common/        guard sesi/izin, enkripsi, transaksi ber-RLS, error
  src/modules/       auth, users, clients, matters, drafting, registry, documents,
                     finance, schedule, reports, portal
  src/worker/        pemroses outbox (notifikasi, pemindaian dokumen)
  test/              unit + e2e
apps/web/            Next.js 15 (App Router) + Tailwind; area kantor & portal klien
docker-compose.yml   postgres, redis, migrate, api, worker, web
```

**Perbedaan dari rancangan:** dokumen rancangan menyebut Prisma; implementasi memakai **Kysely** (query builder SQL bertipe). Alasannya: RLS, `SET LOCAL`, penguncian `UPDATE … RETURNING` untuk nomor akta, dan trigger audit lebih jelas ditulis sebagai SQL; Kysely juga tidak butuh binary engine. Antrean memakai tabel **outbox** yang dibaca worker (`FOR UPDATE SKIP LOCKED`) alih-alih BullMQ; Redis dipakai untuk pembatasan percobaan login/OTP.

## Sebelum dipakai sungguhan

Belum dikerjakan di MVP ini (sesuai rencana Fase 2) atau wajib disiapkan untuk produksi:

- [ ] Validasi format repertorium/klapper/laporan dan aturan penomoran (reset bulanan, jenis buku) dengan Notaris & MPD
- [ ] Template akta resmi kantor (yang ada hanya contoh)
- [ ] Ganti `LocalKms` dengan KMS cloud, dan `StorageService` disk lokal dengan object storage terenkripsi di region Indonesia
- [ ] Adapter email & WhatsApp Business di `outbox.processor.ts` (saat ini notifikasi hanya dicatat ke tabel `notifications`), lalu set `NODE_ENV=production`
- [ ] Pemindaian antivirus (ClamAV) di `scanDocument`; saat ini hanya cek tipe file dan hash
- [ ] HTTPS + `COOKIE_SECURE=true`, backup & uji pemulihan, monitoring/alert, pentest eksternal
- [ ] Integrasi AHU Online / layanan BPN / e-BPHTB (saat ini pelacakan manual), payment gateway, passkey/SSO
- [ ] Portal: email klien yang sama di dua kantor berbeda belum didukung (login memilih yang pertama)
- [ ] Kebijakan privasi, persetujuan klien, dan kebijakan retensi sesuai UU PDP
