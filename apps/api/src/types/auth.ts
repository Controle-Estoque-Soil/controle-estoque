import type { Role } from '@prisma/client';

export type RoleName = Role;

export interface JwtUserPayload {
  sub: string;
  email: string;
  role: RoleName;
}
