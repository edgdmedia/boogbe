import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission as PermissionName } from '@boogbe/shared';
import type { RequestCtx } from './request-ctx';

export const ACCESS_KEY = 'boogbe:access';
export type AccessRule =
  | { kind: 'public' }
  | { kind: 'signedIn' }
  | { kind: 'platformAdmin' }
  | { kind: 'permission'; permission: PermissionName };

export const Public = () => SetMetadata(ACCESS_KEY, { kind: 'public' } satisfies AccessRule);
export const SignedIn = () => SetMetadata(ACCESS_KEY, { kind: 'signedIn' } satisfies AccessRule);
export const PlatformAdmin = () => SetMetadata(ACCESS_KEY, { kind: 'platformAdmin' } satisfies AccessRule);
export const Permission = (permission: PermissionName) =>
  SetMetadata(ACCESS_KEY, { kind: 'permission', permission } satisfies AccessRule);

export const Ctx = createParamDecorator((_: unknown, ec: ExecutionContext): RequestCtx =>
  ec.switchToHttp().getRequest().ctx,
);
