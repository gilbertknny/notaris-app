import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { createUserSchema, NOTARY_ONLY } from '@notaris/shared';
import { Auth, AuthContext, Can, RecentMfa } from '../../common/auth/auth-context';
import { DbService, writeAudit } from '../../common/db.service';
import { AppError, NotFound } from '../../common/errors';
import { parse } from '../../common/validate';
import { SessionService } from '../auth/session.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly dbs: DbService,
    private readonly sessions: SessionService,
  ) {}

  /** Daftar staf aktif — dipakai juga untuk memilih penanggung jawab berkas. */
  @Get()
  async list(@Auth() auth: AuthContext) {
    if (!auth.permissions.has('user.manage') && !auth.permissions.has('matter.assign') && !auth.permissions.has('matter.create')) {
      throw new AppError('FORBIDDEN', 'Anda tidak memiliki izin untuk aksi ini', 403);
    }
    return this.dbs.db
      .selectFrom('users')
      .innerJoin('roles', 'roles.id', 'users.role_id')
      .select(['users.id', 'users.full_name as fullName', 'users.email', 'users.active', 'users.mfa_enabled as mfaEnrolled', 'roles.code as role', 'roles.name as roleName'])
      .where('users.office_id', '=', auth.officeId)
      .orderBy('users.full_name')
      .execute();
  }

  @Can('user.manage')
  @Get('roles')
  roles(@Auth() auth: AuthContext) {
    return this.dbs.db.selectFrom('roles').select(['code', 'name', 'permissions']).where('office_id', '=', auth.officeId).orderBy('name').execute();
  }

  @Can('user.manage')
  @RecentMfa()
  @Post()
  async create(@Auth() auth: AuthContext, @Body() body: unknown) {
    const input = parse(createUserSchema, body);
    const role = await this.dbs.db
      .selectFrom('roles')
      .selectAll()
      .where('office_id', '=', auth.officeId)
      .where('code', '=', input.roleCode)
      .executeTakeFirst();
    if (!role) throw NotFound('Peran');
    // Peran dengan izin khusus Notaris hanya bisa diberikan oleh Notaris.
    if (role.permissions.some((p) => (NOTARY_ONLY as readonly string[]).includes(p)) && !auth.permissions.has('draft.approve')) {
      throw new AppError('FORBIDDEN', 'Hanya Notaris yang bisa membuat akun dengan peran ini', 403);
    }
    const user = await this.dbs.db
      .insertInto('users')
      .values({
        office_id: auth.officeId,
        email: input.email,
        full_name: input.fullName,
        password_hash: await hash(input.password),
        role_id: role.id,
        mfa_secret_enc: null,
      })
      .returning(['id', 'email', 'full_name as fullName'])
      .executeTakeFirstOrThrow();
    await this.dbs.as(auth, (trx) =>
      writeAudit(trx, auth, { action: 'user.created', entity: 'user', entityId: user.id, detail: { role: role.code } }),
    );
    return user;
  }

  @Can('user.manage')
  @RecentMfa()
  @Post(':id/deactivate')
  @HttpCode(200)
  async deactivate(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    if (id === auth.userId) throw new AppError('INVALID', 'Tidak bisa menonaktifkan akun sendiri');
    const res = await this.dbs.db.updateTable('users').set({ active: false }).where('id', '=', id).where('office_id', '=', auth.officeId).executeTakeFirst();
    if (!res.numUpdatedRows) throw NotFound('Pengguna');
    await this.sessions.revokeAllForUser(id);
    await this.dbs.as(auth, (trx) => writeAudit(trx, auth, { action: 'user.deactivated', entity: 'user', entityId: id }));
    return { ok: true };
  }

  /** Cabut semua sesi pengguna seketika (mis. perangkat hilang). */
  @Can('user.manage')
  @Post(':id/revoke-sessions')
  @HttpCode(200)
  async revokeSessions(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const user = await this.dbs.db.selectFrom('users').select('id').where('id', '=', id).where('office_id', '=', auth.officeId).executeTakeFirst();
    if (!user) throw NotFound('Pengguna');
    await this.sessions.revokeAllForUser(id);
    await this.dbs.as(auth, (trx) => writeAudit(trx, auth, { action: 'user.sessions_revoked', entity: 'user', entityId: id }));
    return { ok: true };
  }
}
