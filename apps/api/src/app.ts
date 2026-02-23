import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import type { AppConfig } from './config/env';
import { apiErrorHandler } from './core/error-handler';
import { authRoutes } from './modules/auth/auth.routes';
import { healthRoutes } from './modules/health/health.routes';
import { authPlugin } from './plugins/auth';
import { prismaPlugin } from './plugins/prisma';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'production'
        ? true
        : {
            transport: {
              target: 'pino-pretty',
            },
          },
  });

  app.decorate('config', config);

  app.setErrorHandler(apiErrorHandler);

  await app.register(cors, {
    origin: config.CORS_ORIGIN,
    credentials: true,
  });

  await app.register(prismaPlugin);
  await app.register(authPlugin);
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/auth' });

  return app;
}
