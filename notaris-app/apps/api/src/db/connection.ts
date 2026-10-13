import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';
import type { DB } from './schema';

// Kolom DATE dikembalikan sebagai string 'YYYY-MM-DD' agar tidak bergeser zona waktu.
types.setTypeParser(1082, (v) => v);

export function createDb(connectionString: string, max = 10): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, max }) }),
  });
}
