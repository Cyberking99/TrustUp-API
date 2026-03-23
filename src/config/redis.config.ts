import { ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-store';

/**
 * Configuration factory for the TrustUp API Cache layer.
 * 
 * Uses 'cache-manager-redis-store' (v3 compatible with Nest 10).
 * Defaults to localhost:6379 for local development.
 * 
 * TTL: Time to live in seconds (default: 300 - 5 minutes)
 */
export const getRedisConfig = async (configService: ConfigService): Promise<any> => {
  const isTest = process.env.NODE_ENV === 'test';
  const ttl = configService.get<number>('REPUTATION_CACHE_TTL', 300);

  if (isTest) {
    return {
      ttl,
    };
  }

  return {
    store: await redisStore({
      url: configService.get<string>('REDIS_URL', 'redis://localhost:6379'),
      ttl,
    }),
    ttl,
  };
};
