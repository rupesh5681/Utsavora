import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppAudience } from '@utsavora/validation';
import type { AdminPermission, Role } from '@utsavora/types';
import { AppError, forbidden, unauthorized } from '../common/errors';
import { AuthService } from './auth.service';
import { APP_HEADER, cookieName, IS_PUBLIC, PERMISSIONS, ROLES, type Actor } from './actor';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard.
 *  - Every state-changing request must carry the x-utsavora-app header. Browsers cannot send a
 *    custom header cross-site without a CORS preflight we don't allow, so this doubles as CSRF protection.
 *  - The header selects which session cookie (customer / vendor / admin) is read, so one browser
 *    can be signed in to all three apps without the sessions leaking between them.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { actor?: Actor; cookies: Record<string, string> }>();
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ?? false;
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets) ?? [];
    const perms = this.reflector.getAllAndOverride<AdminPermission[]>(PERMISSIONS, targets) ?? [];

    const headerRaw = req.header(APP_HEADER);
    const parsed = AppAudience.safeParse(headerRaw);
    if (!SAFE_METHODS.has(req.method) && !parsed.success) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'MISSING_APP_HEADER', `The ${APP_HEADER} header is required.`);
    }
    if (parsed.success) {
      const token = req.cookies?.[cookieName(parsed.data)];
      if (token) req.actor = (await this.auth.resolve(token, parsed.data, req.ip ?? null)) ?? undefined;
    }

    if (isPublic) return true;
    const actor = req.actor;
    if (!actor) throw unauthorized();
    const required: Role[] = perms.length > 0 ? ['ADMIN'] : roles;
    if (required.length > 0 && !required.includes(actor.role)) throw forbidden();
    const missing = perms.filter((p) => !actor.permissions.includes(p));
    if (missing.length > 0) throw forbidden(`Missing admin permission: ${missing.join(', ')}`);
    return true;
  }
}
