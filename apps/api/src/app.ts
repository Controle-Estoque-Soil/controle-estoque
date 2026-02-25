import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';

import { getAllowedCorsOrigins, type AppConfig } from './config/env';
import { apiErrorHandler } from './core/error-handler';
import { authRoutes } from './modules/auth/auth.routes';
import { healthRoutes } from './modules/health/health.routes';
import { itemsRoutes } from './modules/items/items.routes';
import { operationsRoutes } from './modules/operations/operations.routes';
import { productsRoutes } from './modules/products/products.routes';
import { usersRoutes } from './modules/users/users.routes';
import { authPlugin } from './plugins/auth';
import { prismaPlugin } from './plugins/prisma';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const corsOrigins = getAllowedCorsOrigins(config);

  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    logger:
      config.NODE_ENV === 'production'
        ? {
            level: config.LOG_LEVEL,
          }
        : {
            level: config.LOG_LEVEL,
            transport: {
              target: 'pino-pretty',
            },
          },
  });

  app.decorate('config', config);

  app.setErrorHandler(apiErrorHandler);

  if (config.ENABLE_SECURITY_HEADERS) {
    await app.register(helmet, {
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    });
  }

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, corsOrigins.includes(origin));
    },
    credentials: true,
  });

  await app.register(prismaPlugin);
  await app.register(authPlugin);
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(itemsRoutes);
  await app.register(productsRoutes);
  await app.register(operationsRoutes);
  await app.register(usersRoutes);

  return app;
}
