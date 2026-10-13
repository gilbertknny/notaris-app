import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@notaris/shared';

export interface AuthContext {
  kind: 'staff' | 'client';
  sessionId: string;
  officeId: string;
  userId: string | null;
  clientId: string | null;
  fullName: string;
  roleCode: string | null;
  permissions: Set<string>;
  mfaVerifiedAt: Date | null;
  ip: string | null;
}

export const STAFF_COOKIE = 'sid';
export const CLIENT_COOKIE = 'psid';

export const IS_PUBLIC = 'auth:public';
export const IS_PORTAL = 'auth:portal';
export const ALLOW_MFA_PENDING = 'auth:mfa-pending';
export const REQUIRED_PERMS = 'auth:perms';
export const RECENT_MFA = 'auth:recent-mfa';

/** Rute tanpa sesi (login, OTP). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Rute portal klien: wajib sesi klien. */
export const Portal = () => SetMetadata(IS_PORTAL, true);
/** Rute yang boleh diakses setelah kata sandi benar tetapi sebelum MFA (setup/verify MFA). */
export const AllowMfaPending = () => SetMetadata(ALLOW_MFA_PENDING, true);
/** Izin peran yang wajib dimiliki (semua). */
export const Can = (...perms: Permission[]) => SetMetadata(REQUIRED_PERMS, perms);
/** Aksi sensitif: MFA terakhir harus dalam N menit terakhir. */
export const RecentMfa = () => SetMetadata(RECENT_MFA, true);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  return ctx.switchToHttp().getRequest().auth;
});
