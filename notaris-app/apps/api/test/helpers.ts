import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Siapkan database test terpisah (dibuat ulang tiap run) dan variabel lingkungan.
 * Butuh PostgreSQL + Redis berjalan; atur TEST_PG_ADMIN_URL bila bukan default.
 */
export async function prepareTestEnv() {
  const admin = process.env.TEST_PG_ADMIN_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres';
  const dbName = `notaris_test_${process.pid}`;
  const c = new Client({ connectionString: admin });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await c.query(`CREATE DATABASE ${dbName}`);
  await c.end();

  const base = new URL(admin);
  const migrator = new URL(base.toString());
  migrator.pathname = `/${dbName}`;
  const appPw = 'test-app-password';
  const app = new URL(migrator.toString());
  app.username = 'notaris_app';
  app.password = appPw;

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL_MIGRATOR: migrator.toString(),
    DATABASE_URL: app.toString(),
    APP_DB_PASSWORD: appPw,
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
    KMS_MASTER_KEY: randomBytes(32).toString('base64'),
    HMAC_KEY: randomBytes(32).toString('base64'),
    STORAGE_DIR: mkdtempSync(join(tmpdir(), 'notaris-storage-')),
    MFA_REAUTH_MINUTES: '15',
  });
  return { admin, dbName, migratorUrl: migrator.toString(), appPw };
}

export async function dropTestDb(admin: string, dbName: string) {
  const c = new Client({ connectionString: admin });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await c.end();
}

export const CSRF = { 'X-Requested-With': 'notaris-web' };

/** PDF minimal yang valid secara tanda tangan file. */
export const SAMPLE_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
