import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AdminPermission, Role } from '@utsavora/types';
import type { AppAudience } from '@utsavora/validation';

export interface Actor {
  userId: string;
  sessionId: string;
  name: string;
  email: string;
  /** The role this session acts as — derived from the app the user signed in to. */
  role: Role;
  audience: AppAudience;
  vendorId: string | null;
  permissions: AdminPermission[];
  ip: string | null;
}

export const AUDIENCE_ROLE: Record<AppAudience, Role> = { customer: 'CUSTOMER', vendor: 'VENDOR', admin: 'ADMIN' };
export const APP_HEADER = 'x-utsavora-app';
export const cookieName = (aud: AppAudience) => `uts_${aud}`;

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';
export const PERMISSIONS = 'permissions';

/** No session required (a session is still attached when present). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Session must be acting as one of these roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
/** Admin session must hold all of these permissions. Implies Roles('ADMIN'). */
export const RequirePermissions = (...perms: AdminPermission[]) => SetMetadata(PERMISSIONS, perms);

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => ctx.switchToHttp().getRequest().actor);
export const OptionalActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor | null => ctx.switchToHttp().getRequest().actor ?? null);
