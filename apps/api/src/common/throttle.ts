import { Throttle } from '@nestjs/throttler';

const env = (k: string, d: number) => () => Number(process.env[k] ?? d);

/** Sign-in / registration: per IP per minute. */
export const AuthThrottle = () => Throttle({ default: { limit: env('AUTH_RATE_LIMIT_PER_MINUTE', 10), ttl: 60_000 } });
/** Customer and vendor writes that notify other people (requests, quotes). */
export const WriteThrottle = () => Throttle({ default: { limit: env('WRITE_RATE_LIMIT_PER_MINUTE', 30), ttl: 60_000 } });
