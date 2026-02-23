import fp from 'fastify-plugin';

import { getPrismaClient } from '../lib/prisma';

export const prismaPlugin = fp(async (fastify) => {
  const prisma = getPrismaClient();

  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});
