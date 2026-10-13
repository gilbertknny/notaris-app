import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema';
import { config } from '../config';

const VERSION = 1;
const KEY_TTL_MS = 5 * 60 * 1000;

/**
 * Pengganti KMS untuk pengembangan: kunci induk dari env membungkus data key per kantor.
 * Di produksi, ganti `wrap`/`unwrap` dengan panggilan ke KMS cloud; kunci induk tidak pernah keluar dari KMS.
 */
export class LocalKms {
  constructor(private readonly masterKey: Buffer) {}
  wrap(dataKey: Buffer): Buffer {
    return sealRaw(this.masterKey, dataKey);
  }
  unwrap(wrapped: Buffer): Buffer {
    return openRaw(this.masterKey, wrapped);
  }
}

function sealRaw(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
}

function openRaw(key: Buffer, blob: Buffer): Buffer {
  if (blob[0] !== VERSION) throw new Error('Versi ciphertext tidak dikenal');
  const iv = blob.subarray(1, 13);
  const tag = blob.subarray(13, 29);
  const ct = blob.subarray(29);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

@Injectable()
export class CryptoService {
  private readonly kms = new LocalKms(Buffer.from(config().KMS_MASTER_KEY, 'base64'));
  private readonly hmacKey = Buffer.from(config().HMAC_KEY, 'base64');
  private readonly cache = new Map<string, { key: Buffer; until: number }>();

  /** Ambil (atau buat) data key kantor; di-cache di memori maksimal 5 menit. */
  async dataKey(db: Kysely<DB>, officeId: string): Promise<Buffer> {
    const hit = this.cache.get(officeId);
    if (hit && hit.until > Date.now()) return hit.key;
    let row = await db.selectFrom('data_keys').select('wrapped_key').where('office_id', '=', officeId).executeTakeFirst();
    if (!row) {
      const fresh = randomBytes(32);
      await db
        .insertInto('data_keys')
        .values({ office_id: officeId, wrapped_key: this.kms.wrap(fresh) })
        .onConflict((oc) => oc.column('office_id').doNothing())
        .execute();
      row = await db.selectFrom('data_keys').select('wrapped_key').where('office_id', '=', officeId).executeTakeFirstOrThrow();
    }
    const key = this.kms.unwrap(row.wrapped_key);
    this.cache.set(officeId, { key, until: Date.now() + KEY_TTL_MS });
    return key;
  }

  async encrypt(db: Kysely<DB>, officeId: string, value: string | null | undefined): Promise<Buffer | null> {
    if (value === null || value === undefined || value === '') return null;
    return sealRaw(await this.dataKey(db, officeId), Buffer.from(value, 'utf8'));
  }

  async decrypt(db: Kysely<DB>, officeId: string, blob: Buffer | null): Promise<string | null> {
    if (!blob) return null;
    return openRaw(await this.dataKey(db, officeId), blob).toString('utf8');
  }

  /** HMAC deterministik untuk pencarian & cek duplikat tanpa dekripsi. Dipisah per kantor. */
  searchHash(officeId: string, value: string | null | undefined): Buffer | null {
    if (!value) return null;
    return createHmac('sha256', this.hmacKey).update(`${officeId}:${value}`).digest();
  }

  sha256(data: Buffer | string): Buffer {
    return createHash('sha256').update(data).digest();
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  /** Token bertanda tangan & kedaluwarsa, mis. untuk link unduh dokumen. */
  sign(payload: Record<string, unknown>, ttlSeconds: number): string {
    const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
    const mac = createHmac('sha256', this.hmacKey).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  verify<T extends Record<string, unknown>>(token: string): T | null {
    const [body, mac] = token.split('.');
    if (!body || !mac) return null;
    const expected = createHmac('sha256', this.hmacKey).update(body).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp: number };
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  }

  /** Untuk test: kosongkan cache data key. */
  clearCache() {
    this.cache.clear();
  }
}
