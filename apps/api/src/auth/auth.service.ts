import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { AppAudience, RegisterCustomerInput, RegisterVendorInput, LoginInput } from '@utsavora/validation';
import type { AdminPermission, Role } from '@utsavora/types';
import { CONFIG, DB, type AppConfig } from '../config';
import { now, type Db, type Tx } from '../db/client';
import { AppError, conflict, forbidden, unauthorized } from '../common/errors';
import { slugify, code } from '../common/ids';
import { AuditService } from '../common/audit.service';
import { AUDIENCE_ROLE, type Actor } from './actor';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface SessionContext {
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class AuthService {
  /** A real hash verified against when the email is unknown, so login timing doesn't reveal which emails exist. */
  private readonly dummyHash = hash(randomBytes(16).toString('hex'));

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  hashPassword(p: string) {
    return hash(p);
  }

  private async createSession(userId: string, audience: AppAudience, ctx: SessionContext) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 3600 * 1000);
    await this.db
      .insertInto('sessions')
      .values({ userId, tokenHash: sha256(token), audience, expiresAt, ip: ctx.ip, userAgent: ctx.userAgent?.slice(0, 300) ?? null })
      .execute();
    return { token, expiresAt };
  }

  private async createUser(tx: Tx, input: RegisterCustomerInput, passwordHash: string, role: Role) {
    const existing = await tx.selectFrom('users').select('id').where('email', '=', input.email).executeTakeFirst();
    if (existing) throw conflict('EMAIL_TAKEN', 'An account with this email already exists. Please sign in.');
    const u = await tx
      .insertInto('users')
      .output('inserted.id')
      .values({ email: input.email, name: input.name, phone: input.phone, passwordHash })
      .executeTakeFirstOrThrow();
    await tx.insertInto('userRoles').values({ userId: u.id, role }).execute();
    return u.id;
  }

  async registerCustomer(input: RegisterCustomerInput, ctx: SessionContext) {
    const passwordHash = await this.hashPassword(input.password);
    const userId = await this.db.transaction().execute((tx) => this.createUser(tx, input, passwordHash, 'CUSTOMER'));
    return this.createSession(userId, 'customer', ctx);
  }

  async registerVendor(input: RegisterVendorInput, ctx: SessionContext) {
    const passwordHash = await this.hashPassword(input.password);
    const userId = await this.db.transaction().execute(async (tx) => {
      const uid = await this.createUser(tx, input, passwordHash, 'VENDOR');
      const v = await tx
        .insertInto('vendors')
        .output('inserted.id')
        .values({ slug: `${slugify(input.businessName)}-${code(4).toLowerCase()}`, businessName: input.businessName, phone: input.phone, gstin: null, fssaiNumber: null, submittedAt: null, approvedAt: null })
        .executeTakeFirstOrThrow();
      await tx.insertInto('vendorMembers').values({ vendorId: v.id, userId: uid, role: 'OWNER' }).execute();
      await this.audit.record(null, { action: 'vendor.registered', entityType: 'vendor', entityId: v.id, metadata: { userId: uid } }, tx);
      return uid;
    });
    return this.createSession(userId, 'vendor', ctx);
  }

  private rolesOf(userId: string) {
    return this.db.selectFrom('userRoles').select('role').where('userId', '=', userId).execute();
  }

  async login(input: LoginInput, audience: AppAudience, ctx: SessionContext) {
    const user = await this.db.selectFrom('users').selectAll().where('email', '=', input.email).executeTakeFirst();
    const ok = await verify(user?.passwordHash ?? (await this.dummyHash), input.password).catch(() => false);
    if (!user || !ok || !user.isActive) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    const needed = AUDIENCE_ROLE[audience];
    if (!(await this.rolesOf(user.id)).some((r) => r.role === needed)) {
      const where = { customer: 'the customer site', vendor: 'the vendor portal', admin: 'the admin portal' }[audience];
      throw forbidden(`This account doesn't have access to ${where}.`);
    }
    if (audience === 'admin') {
      await this.audit.record(null, { action: 'admin.login', entityType: 'user', entityId: user.id, metadata: { ip: ctx.ip } });
    }
    return this.createSession(user.id, audience, ctx);
  }

  async logout(sessionId: string) {
    await this.db.updateTable('sessions').set({ revokedAt: now() }).where('id', '=', sessionId).execute();
  }

  /** Resolves a raw cookie token to an Actor, or null if invalid/expired/revoked. */
  async resolve(token: string, audience: AppAudience, ip: string | null): Promise<Actor | null> {
    if (!token || token.length > 200) return null;
    const session = await this.db
      .selectFrom('sessions')
      .selectAll()
      .where('tokenHash', '=', sha256(token))
      .where('revokedAt', 'is', null)
      .where('expiresAt', '>', now())
      .executeTakeFirst();
    if (!session || session.audience !== audience) return null;
    const user = await this.db.selectFrom('users').selectAll().where('id', '=', session.userId).executeTakeFirst();
    if (!user || !user.isActive) return null;
    const role: Role = AUDIENCE_ROLE[audience];
    if (!(await this.rolesOf(user.id)).some((r) => r.role === role)) return null;
    if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
      await this.db.updateTable('sessions').set({ lastSeenAt: now() }).where('id', '=', session.id).execute();
    }
    const vendorId =
      role === 'VENDOR'
        ? ((await this.db.selectFrom('vendorMembers').select('vendorId').where('userId', '=', user.id).orderBy('createdAt').executeTakeFirst())?.vendorId ?? null)
        : null;
    const permissions =
      role === 'ADMIN'
        ? (await this.db.selectFrom('userAdminPermissions').select('permission').where('userId', '=', user.id).execute()).map((p) => p.permission as AdminPermission)
        : [];
    return { userId: user.id, sessionId: session.id, name: user.name, email: user.email, role, audience, vendorId, permissions, ip };
  }

  async me(actor: Actor) {
    const user = await this.db.selectFrom('users').select(['id', 'name', 'email', 'phone']).where('id', '=', actor.userId).executeTakeFirst();
    if (!user) throw unauthorized();
    let vendor = null;
    if (actor.vendorId) {
      const v = await this.db
        .selectFrom('vendors')
        .select(['id', 'businessName', 'status', 'slug', 'isDemo'])
        .where('id', '=', actor.vendorId)
        .executeTakeFirst();
      vendor = v ?? null;
    }
    return { id: user.id, name: user.name, email: user.email, phone: user.phone, role: actor.role, permissions: actor.permissions, vendor };
  }

  /** Revoke every session for a user (used on suspension, password change). */
  async revokeAll(userId: string) {
    await this.db.updateTable('sessions').set({ revokedAt: now() }).where('userId', '=', userId).where('revokedAt', 'is', null).execute();
  }
}
