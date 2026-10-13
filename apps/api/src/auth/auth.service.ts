import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { AppAudience, RegisterCustomerInput, RegisterVendorInput, LoginInput } from '@utsavora/validation';
import type { AdminPermission, Role } from '@utsavora/types';
import { CONFIG, DB, type AppConfig } from '../config';
import type { Db } from '../db/client';
import { sessions, userAdminPermissions, userRoles, users, vendorMembers, vendors } from '../db/schema';
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
    await this.db.insert(sessions).values({
      userId,
      tokenHash: sha256(token),
      audience,
      expiresAt,
      ip: ctx.ip,
      userAgent: ctx.userAgent?.slice(0, 300) ?? null,
    });
    return { token, expiresAt };
  }

  async registerCustomer(input: RegisterCustomerInput, ctx: SessionContext) {
    const passwordHash = await this.hashPassword(input.password);
    const userId = await this.db.transaction(async (tx) => {
      const existing = await tx.query.users.findFirst({ where: eq(users.email, input.email) });
      if (existing) throw conflict('EMAIL_TAKEN', 'An account with this email already exists. Please sign in.');
      const [u] = await tx.insert(users).values({ email: input.email, name: input.name, phone: input.phone, passwordHash }).returning();
      await tx.insert(userRoles).values({ userId: u.id, role: 'CUSTOMER' });
      return u.id;
    });
    return this.createSession(userId, 'customer', ctx);
  }

  async registerVendor(input: RegisterVendorInput, ctx: SessionContext) {
    const passwordHash = await this.hashPassword(input.password);
    const userId = await this.db.transaction(async (tx) => {
      const existing = await tx.query.users.findFirst({ where: eq(users.email, input.email) });
      if (existing) throw conflict('EMAIL_TAKEN', 'An account with this email already exists. Please sign in.');
      const [u] = await tx.insert(users).values({ email: input.email, name: input.name, phone: input.phone, passwordHash }).returning();
      await tx.insert(userRoles).values({ userId: u.id, role: 'VENDOR' });
      const [v] = await tx
        .insert(vendors)
        .values({ slug: `${slugify(input.businessName)}-${code(4).toLowerCase()}`, businessName: input.businessName, phone: input.phone })
        .returning();
      await tx.insert(vendorMembers).values({ vendorId: v.id, userId: u.id, role: 'OWNER' });
      await this.audit.record(null, { action: 'vendor.registered', entityType: 'vendor', entityId: v.id, metadata: { userId: u.id } }, tx);
      return u.id;
    });
    return this.createSession(userId, 'vendor', ctx);
  }

  async login(input: LoginInput, audience: AppAudience, ctx: SessionContext) {
    const user = await this.db.query.users.findFirst({ where: eq(users.email, input.email), with: { roles: true } });
    const ok = await verify(user?.passwordHash ?? (await this.dummyHash), input.password).catch(() => false);
    if (!user || !ok || !user.isActive) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    const needed = AUDIENCE_ROLE[audience];
    if (!user.roles.some((r) => r.role === needed)) {
      const where = { customer: 'the customer site', vendor: 'the vendor portal', admin: 'the admin portal' }[audience];
      throw forbidden(`This account doesn't have access to ${where}.`);
    }
    if (audience === 'admin') {
      await this.audit.record(null, { action: 'admin.login', entityType: 'user', entityId: user.id, metadata: { ip: ctx.ip } });
    }
    return this.createSession(user.id, audience, ctx);
  }

  async logout(sessionId: string) {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
  }

  /** Resolves a raw cookie token to an Actor, or null if invalid/expired/revoked. */
  async resolve(token: string, audience: AppAudience, ip: string | null): Promise<Actor | null> {
    if (!token || token.length > 200) return null;
    const session = await this.db.query.sessions.findFirst({
      where: and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())),
    });
    if (!session || session.audience !== audience) return null;
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, session.userId),
      with: { roles: true, adminPermissions: true, vendorMemberships: true },
    });
    if (!user || !user.isActive) return null;
    const role: Role = AUDIENCE_ROLE[audience];
    if (!user.roles.some((r) => r.role === role)) return null;
    if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
      await this.db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, session.id));
    }
    return {
      userId: user.id,
      sessionId: session.id,
      name: user.name,
      email: user.email,
      role,
      audience,
      vendorId: role === 'VENDOR' ? (user.vendorMemberships[0]?.vendorId ?? null) : null,
      permissions: role === 'ADMIN' ? (user.adminPermissions.map((p) => p.permission) as AdminPermission[]) : [],
      ip,
    };
  }

  async me(actor: Actor) {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, actor.userId) });
    if (!user) throw unauthorized();
    let vendor = null;
    if (actor.vendorId) {
      const v = await this.db.query.vendors.findFirst({ where: eq(vendors.id, actor.vendorId) });
      vendor = v ? { id: v.id, businessName: v.businessName, status: v.status, slug: v.slug, isDemo: v.isDemo } : null;
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: actor.role,
      permissions: actor.permissions,
      vendor,
    };
  }

  /** Revoke every session for a user except optionally one (used on suspension, password change). */
  async revokeAll(userId: string) {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  async hasRole(userId: string, role: Role) {
    const r = await this.db.select().from(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.role, role)));
    return r.length > 0;
  }

  async permissionsOf(userId: string) {
    return (await this.db.select().from(userAdminPermissions).where(eq(userAdminPermissions.userId, userId))).map((p) => p.permission);
  }
}
