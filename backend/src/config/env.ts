import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_TIMEZONE: z.string().default('Asia/Riyadh'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),
  DB_SSL: bool.default(false),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('10h'),
  JWT_ISSUER: z.string().default('dar-al-dhiafa-ims'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  QR_BASE_URL: z.string().url().default('https://haccp.daraldhiafa.sa/q'),

  HEALTH_CERT_WARNING_DAYS: z.coerce.number().int().positive().default(30),
  SCHEDULER_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  EXPO_PUSH_ENABLED: bool.default(false),
  /** Database role the API switches to (no BYPASSRLS) so Row-Level Security isolates companies. */
  DB_APP_ROLE: z.string().regex(/^[a-z_][a-z0-9_]*$/).default('dar_app'),

  /** Public URL of the web app (links in e-mails: activation, password reset). */
  APP_URL: z.string().url().default('http://localhost:8081'),

  /** E-mail delivery for OTP codes and notifications. `log` = development only (never delivers). */
  EMAIL_PROVIDER: z.enum(['log', 'smtp', 'resend']).default('log'),
  EMAIL_FROM: z.string().default('DarHaccp <no-reply@darhaccp.sa>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),

  /** Platform (SaaS operator) administrator created by the seed, and recipient of new-registration notices. */
  PLATFORM_ADMIN_EMAIL: z.string().email().default('platform-admin@darhaccp.sa'),
  PLATFORM_ADMIN_PASSWORD: z.string().min(12).optional(),

  /** 64 hex chars (32 bytes): AES-256-GCM key for sensitive personal data (national ID / iqama). */
  DATA_ENCRYPTION_KEY: z
    .string()
    .regex(/^([0-9a-f]{64})?$/i, 'DATA_ENCRYPTION_KEY must be 64 hex characters')
    .optional()
    .transform((v) => v || undefined),
  /** Shared secret for scheduled jobs (Vercel Cron sends it as a Bearer token). */
  CRON_SECRET: z.string().min(16).optional(),

  SEED_ADMIN_EMAIL: z.string().email().default('admin@daraldhiafa.sa'),
  SEED_ADMIN_PASSWORD: z.string().min(10).default('ChangeMe!2026'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // Fail fast: the server must never boot with an invalid security configuration.
  console.error(`Invalid environment configuration:\n${details}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
