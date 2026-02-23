import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5432/controle_estoque_test?schema=public';

const sharedEnv = {
  ...process.env,
  E2E_DATABASE_URL: e2eDatabaseUrl,
  DATABASE_URL: e2eDatabaseUrl,
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '3333',
  JWT_SECRET: 'test-secret-with-at-least-16-chars',
  BCRYPT_SALT_ROUNDS: '10',
  CORS_ORIGIN: 'http://127.0.0.1:3000',
  SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com',
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD ?? 'admin12345',
  NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3333',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  globalSetup: './e2e/global-setup.ts',
  webServer: [
    {
      command: 'npm run start:e2e -w @controle/api',
      cwd: repoRoot,
      url: 'http://127.0.0.1:3333/health',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: sharedEnv,
    },
    {
      command: 'npm run dev:e2e -w @controle/web',
      cwd: repoRoot,
      url: 'http://127.0.0.1:3000/login',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: sharedEnv,
    },
  ],
});
