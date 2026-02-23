import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient__: PrismaClient | undefined;
}

export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}

export function getPrismaClient(): PrismaClient {
  if (process.env.NODE_ENV === 'production') {
    return createPrismaClient();
  }

  if (!global.__prismaClient__) {
    global.__prismaClient__ = createPrismaClient();
  }

  return global.__prismaClient__;
}
