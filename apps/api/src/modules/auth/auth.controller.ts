import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { hash, verify } from '@node-rs/argon2';
import { authenticator } from 'otplib';
import { loginSchema, mfaCodeSchema } from '@notaris/shared';
import { AllowMfaPending, Auth, AuthContext, Public } from '../../common/auth/auth-context';
import { CryptoService } from '../../common/crypto.service';
import { DbService, writeAudit } from '../../common/db.service';
import { AppError } from '../../common/errors';
import { RedisService } from '../../common/redis.service';
import { parse } from '../../common/validate';
import { SessionService } from './session.service';

authenticator.options = { window: 1 };

const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW_S = 15 * 60;
// Hash dummy agar waktu respons sama walau email tidak terdaftar.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hash('dummy-password-for-timing'));

@Controller('auth')
export class AuthController {
  constructor(
    private readonly dbs: DbService,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { email, password } = parse(loginSchema, body);
    const failKey = `login:fail:${email}`;
    if ((await this.redis.count(failKey)) >= LOGIN_MAX_FAILS) {
      throw new AppError('TOO_MANY_ATTEMPTS', 'Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.', 429);
    }
    const user = await this.dbs.db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst();
    const ok = await verify(user?.password_hash ?? (await getDummyHash()), password).catch(() => false);
    if (!user || !ok || !user.active) {
      await this.redis.hit(failKey, LOGIN_WINDOW_S);
      if (user) {
        await this.dbs.tx({ officeId: user.office_id }, (trx) =>
          writeAudit(trx, null, { officeId: user.office_id, action: 'login.failed', entity: 'user', entityId: user.id, detail: { ip: req.ip } }),
        );
      }
      // Pesan generik: tidak membocorkan apakah email terdaftar.
      throw new AppError('INVALID_CREDENTIALS', 'Email atau kata sandi salah', 401);
    }
    await this.sessions.create('staff', { officeId: user.office_id, userId: user.id }, req, res);
    return { mfaRequired: true, mfaEnrolled: user.mfa_enabled };
  }

  /** Langkah pendaftaran MFA pertama kali: kembalikan URL otpauth untuk aplikasi autentikator. */
  @AllowMfaPending()
  @Post('mfa/setup')
  @HttpCode(200)
  async setupMfa(@Auth() auth: AuthContext) {
    const user = await this.dbs.db.selectFrom('users').selectAll().where('id', '=', auth.userId!).executeTakeFirstOrThrow();
    if (user.mfa_enabled) throw new AppError('MFA_ALREADY_ENROLLED', 'MFA sudah aktif untuk akun ini', 409);
    const secret = authenticator.generateSecret();
    const enc = await this.crypto.encrypt(this.dbs.db, auth.officeId, secret);
    await this.dbs.db.updateTable('users').set({ mfa_secret_enc: enc }).where('id', '=', user.id).execute();
    return { secret, otpauthUrl: authenticator.keyuri(user.email, 'Aplikasi Notaris', secret) };
  }

  /** Verifikasi kode TOTP: menyelesaikan login, mengaktifkan MFA, atau re-autentikasi aksi sensitif. */
  @AllowMfaPending()
  @Post('mfa/verify')
  @HttpCode(200)
  async verifyMfa(@Auth() auth: AuthContext, @Body() body: unknown) {
    const { code } = parse(mfaCodeSchema, body);
    const failKey = `mfa:fail:${auth.userId}`;
    if ((await this.redis.count(failKey)) >= LOGIN_MAX_FAILS) {
      await this.sessions.revoke(auth.sessionId);
      throw new AppError('TOO_MANY_ATTEMPTS', 'Terlalu banyak kode salah. Silakan login ulang nanti.', 429);
    }
    const user = await this.dbs.db.selectFrom('users').selectAll().where('id', '=', auth.userId!).executeTakeFirstOrThrow();
    const secret = await this.crypto.decrypt(this.dbs.db, auth.officeId, user.mfa_secret_enc);
    if (!secret) throw new AppError('MFA_NOT_SETUP', 'MFA belum disiapkan', 400);
    if (!authenticator.check(code, secret)) {
      await this.redis.hit(failKey, LOGIN_WINDOW_S);
      throw new AppError('INVALID_MFA_CODE', 'Kode MFA salah atau kedaluwarsa', 401);
    }
    await this.redis.reset(failKey);
    await this.redis.reset(`login:fail:${user.email}`);
    const first = !auth.mfaVerifiedAt;
    await this.dbs.db.updateTable('users').set({ mfa_enabled: true }).where('id', '=', user.id).execute();
    await this.dbs.db.updateTable('sessions').set({ mfa_verified_at: new Date() }).where('id', '=', auth.sessionId).execute();
    await this.dbs.as(auth, (trx) =>
      writeAudit(trx, auth, { action: first ? 'login.success' : 'mfa.reauth', entity: 'user', entityId: user.id }),
    );
    return { ok: true };
  }

  @AllowMfaPending()
  @Post('logout')
  @HttpCode(200)
  async logout(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(auth.sessionId);
    this.sessions.clear(res, 'staff');
    return { ok: true };
  }

  @AllowMfaPending()
  @Get('me')
  async me(@Auth() auth: AuthContext) {
    const office = await this.dbs.db.selectFrom('offices').selectAll().where('id', '=', auth.officeId).executeTakeFirstOrThrow();
    const user = await this.dbs.db.selectFrom('users').select(['email', 'mfa_enabled']).where('id', '=', auth.userId!).executeTakeFirstOrThrow();
    return {
      id: auth.userId,
      fullName: auth.fullName,
      email: user.email,
      role: auth.roleCode,
      permissions: [...auth.permissions].sort(),
      mfaEnrolled: user.mfa_enabled,
      mfaVerified: !!auth.mfaVerifiedAt,
      office: { id: office.id, name: office.name, notaryName: office.notary_name, timezone: office.timezone },
    };
  }
}
