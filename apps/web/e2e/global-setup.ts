import { execSync } from 'node:child_process';
import path from 'node:path';

export default async function globalSetup(): Promise<void> {
  const repoRoot = path.resolve(__dirname, '../../..');
  const databaseUrl =
    process.env.E2E_DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:5432/controle_estoque_test?schema=public';

  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    JWT_SECRET: process.env.JWT_SECRET ?? 'test-secret-with-at-least-16-chars',
    BCRYPT_SALT_ROUNDS: process.env.BCRYPT_SALT_ROUNDS ?? '10',
    CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://127.0.0.1:3000',
    SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com',
    SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD ?? 'admin12345',
  };

  execSync('npm run prisma:migrate:reset -w @controle/api', {
    cwd: repoRoot,
    env: env as NodeJS.ProcessEnv,
    stdio: 'inherit',
  });

  execSync('npm run prisma:seed -w @controle/api', {
    cwd: repoRoot,
    env: env as NodeJS.ProcessEnv,
    stdio: 'inherit',
  });
}
