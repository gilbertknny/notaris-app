import 'reflect-metadata';
import { authenticator } from 'otplib';
import { CryptoService } from '../common/crypto.service';
import { config } from '../config';
import { createDb } from './connection';

/** HANYA untuk pengembangan: cetak kode MFA terkini untuk akun demo. */
async function main() {
  if (config().NODE_ENV === 'production') {
    console.error('Perintah ini dinonaktifkan di produksi.');
    process.exit(1);
  }
  const email = process.argv[2];
  if (!email) {
    console.error('Pemakaian: pnpm --filter @notaris/api otp <email>');
    process.exit(1);
  }
  const db = createDb(process.env.DATABASE_URL_MIGRATOR ?? config().DATABASE_URL, 1);
  try {
    const user = await db.selectFrom('users').select(['office_id', 'mfa_secret_enc']).where('email', '=', email.toLowerCase()).executeTakeFirst();
    if (!user?.mfa_secret_enc) throw new Error('Pengguna tidak ditemukan atau MFA belum disiapkan');
    const secret = await new CryptoService().decrypt(db, user.office_id, user.mfa_secret_enc);
    console.log(authenticator.generate(secret!));
  } finally {
    await db.destroy();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
