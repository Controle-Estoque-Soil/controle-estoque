import fastifyJwt from '@fastify/jwt';
import fp from 'fastify-plugin';

import { appErrors } from '../core/app-error';
import type { RoleName } from '../types/auth';

export const authPlugin = fp(async (fastify) => {
  await fastify.register(fastifyJwt, {
    secret: fastify.config.JWT_SECRET,
  });

  fastify.decorate('authenticate', async (request) => {
    try {
      await request.jwtVerify();
    } catch {
      throw appErrors.unauthorized('Invalid or expired token');
    }
  });

  fastify.decorate('requireRole', (request, role: RoleName) => {
    if (!request.user || request.user.role !== role) {
      throw appErrors.forbidden('Insufficient permissions');
    }
  });
});
