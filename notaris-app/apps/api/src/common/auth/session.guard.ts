import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { sql } from 'kysely';
import { config } from '../../config';
import { CryptoService } from '../crypto.service';
import { DbService } from '../db.service';
import { AppError } from '../errors';
import {
  ALLOW_MFA_PENDING,
  AuthContext,
  CLIENT_COOKIE,
  IS_PORTAL,
  IS_PUBLIC,
  RECENT_MFA,
  REQUIRED_PERMS,
  STAFF_COOKIE,
} from './auth-context';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'notaris-web';

/**
 * Guard global: CSRF → sesi → MFA → izin peran → MFA ulang untuk aksi sensitif.
 * Izin per berkas diperiksa di service (MatterAccess) karena butuh id berkas.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dbs: DbService,
    private readonly crypto: CryptoService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const meta = <T>(key: string) => this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);

    if (!SAFE_METHODS.has(req.method) && req.get(CSRF_HEADER) !== CSRF_VALUE) {
      throw new AppError('CSRF', 'Permintaan ditolak (header keamanan tidak ada)', 403);
    }
    if (meta<boolean>(IS_PUBLIC)) return true;

    const portal = !!meta<boolean>(IS_PORTAL);
    const token: string | undefined = req.cookies?.[portal ? CLIENT_COOKIE : STAFF_COOKIE];
    if (!token) throw new AppError('UNAUTHENTICATED', 'Silakan login terlebih dahulu', 401);

    const auth = await this.loadSession(token, portal ? 'client' : 'staff', req.ip ?? null);
    req.auth = auth;

    if (auth.kind === 'staff' && !auth.mfaVerifiedAt && !meta<boolean>(ALLOW_MFA_PENDING)) {
      throw new AppError('MFA_REQUIRED', 'Verifikasi MFA diperlukan', 401);
    }
    const perms = meta<string[]>(REQUIRED_PERMS) ?? [];
    const missing = perms.filter((p) => !auth.permissions.has(p));
    if (missing.length) {
      await this.dbs.as(auth, (trx) =>
        trx.insertInto('audit_log').values({
          office_id: auth.officeId,
          actor_type: auth.kind,
          actor_id: auth.userId,
          action: 'access.denied',
          entity: 'route',
          entity_id: `${req.method} ${req.route?.path ?? req.path}`,
          ip: auth.ip,
          detail: JSON.stringify({ missing }),
        }).execute(),
      );
      throw new AppError('FORBIDDEN', 'Anda tidak memiliki izin untuk aksi ini', 403, { missing });
    }
    if (meta<boolean>(RECENT_MFA)) {
      const limit = Date.now() - config().MFA_REAUTH_MINUTES * 60_000;
      if (!auth.mfaVerifiedAt || auth.mfaVerifiedAt.getTime() < limit) {
        throw new AppError('MFA_REAUTH_REQUIRED', 'Masukkan kode MFA lagi untuk aksi ini', 401);
      }
    }
    return true;
  }

  private async loadSession(token: string, kind: 'staff' | 'client', ip: string | null): Promise<AuthContext> {
    const c = config();
    const hash = this.crypto.sha256(token);
    const idleMin = kind === 'staff' ? c.STAFF_IDLE_MINUTES : c.CLIENT_IDLE_MINUTES;
    const db = this.dbs.db;

    const s = await db
      .selectFrom('sessions')
      .selectAll()
      .where('token_hash', '=', hash)
      .where('kind', '=', kind)
      .executeTakeFirst();
    const now = Date.now();
    if (!s || s.revoked_at || s.expires_at.getTime() < now || s.last_seen_at.getTime() + idleMin * 60_000 < now) {
      if (s && !s.revoked_at) {
        await db.updateTable('sessions').set({ revoked_at: new Date() }).where('id', '=', s.id).execute();
      }
      throw new AppError('SESSION_EXPIRED', 'Sesi berakhir, silakan login kembali', 401);
    }
    if (now - s.last_seen_at.getTime() > 60_000) {
      await db.updateTable('sessions').set({ last_seen_at: sql`now()` }).where('id', '=', s.id).execute();
    }

    if (kind === 'staff') {
      const u = await db
        .selectFrom('users')
        .innerJoin('roles', 'roles.id', 'users.role_id')
        .select(['users.id', 'users.full_name', 'users.active', 'roles.code', 'roles.permissions'])
        .where('users.id', '=', s.user_id!)
        .executeTakeFirst();
      if (!u || !u.active) throw new AppError('UNAUTHENTICATED', 'Akun tidak aktif', 401);
      return {
        kind,
        sessionId: s.id,
        officeId: s.office_id,
        userId: u.id,
        clientId: null,
        fullName: u.full_name,
        roleCode: u.code,
        permissions: new Set(u.permissions),
        mfaVerifiedAt: s.mfa_verified_at,
        ip,
      };
    }
    const client = await this.dbs.tx({ officeId: s.office_id }, (trx) =>
      trx.selectFrom('clients').select(['id', 'full_name']).where('id', '=', s.client_id!).executeTakeFirst(),
    );
    if (!client) throw new AppError('UNAUTHENTICATED', 'Akun klien tidak ditemukan', 401);
    return {
      kind,
      sessionId: s.id,
      officeId: s.office_id,
      userId: null,
      clientId: client.id,
      fullName: client.full_name,
      roleCode: null,
      permissions: new Set(),
      mfaVerifiedAt: null,
      ip,
    };
  }
}
