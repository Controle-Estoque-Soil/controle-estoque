import dotenv from 'dotenv';

import { buildApp } from './app';
import { loadEnvConfig } from './config/env';

async function bootstrap(): Promise<void> {
  dotenv.config();

  const config = loadEnvConfig();
  const app = await buildApp(config);

  await app.listen({
    host: config.HOST,
    port: config.PORT,
  });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
