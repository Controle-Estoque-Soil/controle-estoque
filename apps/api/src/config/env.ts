import { z } from 'zod';

const envBoolean = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'n', 'off', ''].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(16).default(12),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().optional(),
  TRUST_PROXY: envBoolean.default(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ENABLE_SECURITY_HEADERS: envBoolean.default(true),
  OUTBOUND_OPERATION_EMAIL_ENABLED: envBoolean.default(true),
  OUTBOUND_OPERATION_EMAIL_TO: z.string().email().default('jose.queiroz@soiltech.com.br'),
  OUTBOUND_OPERATION_EMAIL_SUBJECT: z.string().min(1).default('Saida de Produto Soil Tecnologia'),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: envBoolean.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).max(128).optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadEnvConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}

export function getAllowedCorsOrigins(config: AppConfig): string[] {
  const csv = config.CORS_ORIGINS?.trim();
  if (csv) {
    return csv
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  return [config.CORS_ORIGIN];
}
