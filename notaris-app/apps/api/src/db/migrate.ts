import '../config'; // memuat .env
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

export const MIGRATIONS_DIR = resolve(__dirname, '../../db/migrations');

/**
 * Menjalankan migrasi SQL berurutan dengan koneksi pemilik skema.
 * Juga memastikan role aplikasi `notaris_app` ada (login, bukan pemilik tabel).
 */
export async function migrate(migratorUrl: string, appPassword: string, log = console.log) {
  const client = new Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notaris_app') THEN
          CREATE ROLE notaris_app LOGIN NOINHERIT;
        END IF;
      END $$;`);
    await client.query(`ALTER ROLE notaris_app WITH LOGIN PASSWORD ${quoteLiteral(appPassword)}`);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

    const applied = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
      log(`→ migrasi ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migrasi ${file} gagal: ${(err as Error).message}`);
      }
    }
    log('Migrasi selesai.');
  } finally {
    await client.end();
  }
}

function quoteLiteral(v: string) {
  return `'${v.replace(/'/g, "''")}'`;
}

if (require.main === module) {
  const url = process.env.DATABASE_URL_MIGRATOR;
  const pw = process.env.APP_DB_PASSWORD;
  if (!url || !pw) {
    console.error('DATABASE_URL_MIGRATOR dan APP_DB_PASSWORD wajib diisi.');
    process.exit(1);
  }
  migrate(url, pw).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
