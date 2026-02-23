import type { PrismaClient } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AppConfig } from '../config/env';
import type { JwtUserPayload, RoleName } from './auth';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    prisma: PrismaClient;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (request: FastifyRequest, role: RoleName) => void;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: JwtUserPayload;
    payload: JwtUserPayload;
  }
}
