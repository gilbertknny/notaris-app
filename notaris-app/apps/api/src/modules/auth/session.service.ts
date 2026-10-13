import { Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { config } from '../../config';
import { CryptoService } from '../../common/crypto.service';
import { DbService } from '../../common/db.service';
import { CLIENT_COOKIE, STAFF_COOKIE } from '../../common/auth/auth-context';

@Injectable()
export class SessionService {
  constructor(
    private readonly dbs: DbService,
    private readonly crypto: CryptoService,
  ) {}

  /** Buat sesi server-side; yang disimpan hanya hash token. */
  async create(
    kind: 'staff' | 'client',
    ids: { officeId: string; userId?: string; clientId?: string },
    req: Request,
    res: Response,
  ) {
    const c = config();
    const token = this.crypto.randomToken();
    const maxHours = kind === 'staff' ? c.STAFF_MAX_HOURS : c.CLIENT_MAX_HOURS;
    const expires = new Date(Date.now() + maxHours * 3600_000);
    const row = await this.dbs.db
      .insertInto('sessions')
      .values({
        token_hash: this.crypto.sha256(token),
        kind,
        office_id: ids.officeId,
        user_id: ids.userId ?? null,
        client_id: ids.clientId ?? null,
        mfa_verified_at: null,
        expires_at: expires,
        revoked_at: null,
        ip: req.ip ?? null,
        user_agent: req.get('user-agent')?.slice(0, 300) ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    res.cookie(kind === 'staff' ? STAFF_COOKIE : CLIENT_COOKIE, token, { ...this.cookieOptions(), expires });
    return row.id;
  }

  async revoke(sessionId: string) {
    await this.dbs.db.updateTable('sessions').set({ revoked_at: new Date() }).where('id', '=', sessionId).execute();
  }

  async revokeAllForUser(userId: string) {
    await this.dbs.db
      .updateTable('sessions')
      .set({ revoked_at: new Date() })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  clear(res: Response, kind: 'staff' | 'client') {
    res.clearCookie(kind === 'staff' ? STAFF_COOKIE : CLIENT_COOKIE, this.cookieOptions());
  }

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: config().COOKIE_SECURE, sameSite: 'strict', path: '/' };
  }
}
