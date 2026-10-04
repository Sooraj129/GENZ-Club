import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  SESSION_MONITOR_INTERVAL_MS: z.coerce.number().int().min(1000).default(15000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Vercel sends this as "Authorization: Bearer <secret>" when it runs the scheduled job. */
  CRON_SECRET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Only variable names and messages are printed — never the values.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  clientOrigins: parsed.data.CLIENT_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean),
  /**
   * True on Vercel (serverless functions). There is no long-running process there,
   * so no Socket.IO server and no 15-second timer — the session monitor runs on
   * incoming requests instead (see middleware/lazySessionMonitor.ts).
   */
  serverless: process.env.VERCEL === '1',
};

/** All business operations run in this timezone. */
export const BUSINESS_TIMEZONE = 'Asia/Kolkata';
