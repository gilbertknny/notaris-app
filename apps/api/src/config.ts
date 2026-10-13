import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/** Muat .env di root monorepo (pengembangan lokal). Variabel yang sudah ada tidak ditimpa. */
function loadDotEnv() {
  for (const p of [resolve(process.cwd(), '.env'), resolve(__dirname, '../../../.env')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
    return;
  }
}
loadDotEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  /** Koneksi aplikasi (role notaris_app, tunduk RLS). */
  DATABASE_URL: z.string().url(),
  /** Koneksi pemilik skema, hanya untuk migrasi & seed. */
  DATABASE_URL_MIGRATOR: z.string().url().optional(),
  APP_DB_PASSWORD: z.string().min(8).optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** Kunci induk 32 byte (base64) untuk membungkus data key per kantor. Produksi: ganti dengan KMS. */
  KMS_MASTER_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'KMS_MASTER_KEY harus 32 byte base64'),
  /** Kunci HMAC 32 byte (base64) untuk hash pencarian NIK/NPWP dan URL bertanda tangan. */
  HMAC_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'HMAC_KEY harus 32 byte base64'),
  STORAGE_DIR: z.string().default('./storage'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  STAFF_IDLE_MINUTES: z.coerce.number().default(30),
  STAFF_MAX_HOURS: z.coerce.number().default(12),
  CLIENT_IDLE_MINUTES: z.coerce.number().default(15),
  CLIENT_MAX_HOURS: z.coerce.number().default(24),
  MFA_REAUTH_MINUTES: z.coerce.number().default(15),
  MAX_UPLOAD_MB: z.coerce.number().default(15),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

export function config(): AppConfig {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Konfigurasi tidak valid:\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Untuk test: muat ulang setelah process.env diubah. */
export function resetConfig() {
  cached = undefined;
}
