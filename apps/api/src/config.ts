export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  cookieSecure: boolean;
  sessionTtlHours: number;
  authRateLimitPerMinute: number;
  writeRateLimitPerMinute: number;
  outboxIntervalMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const nodeEnv = env.NODE_ENV ?? 'development';
  const cookieSecure = env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : nodeEnv === 'production';
  return {
    nodeEnv,
    port: Number(env.PORT ?? 4000),
    databaseUrl,
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    cookieSecure,
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 168),
    authRateLimitPerMinute: Number(env.AUTH_RATE_LIMIT_PER_MINUTE ?? 10),
    writeRateLimitPerMinute: Number(env.WRITE_RATE_LIMIT_PER_MINUTE ?? 30),
    outboxIntervalMs: Number(env.OUTBOX_INTERVAL_MS ?? 3000),
  };
}

export const CONFIG = Symbol('CONFIG');
export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');
