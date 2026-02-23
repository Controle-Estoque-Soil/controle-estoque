import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import { BcryptPasswordService } from '../src/lib/password';

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required');
  }

  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? '12');
  const passwordService = new BcryptPasswordService(saltRounds);
  const prisma = new PrismaClient();

  const passwordHash = await passwordService.hash(password);

  await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: {
      passwordHash,
      role: 'ADMIN',
    },
    create: {
      email: email.toLowerCase(),
      passwordHash,
      role: 'ADMIN',
    },
  });

  await prisma.$disconnect();
}

main().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
