import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisClient = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 2000),
  family: 4,
});

redisClient.on('error', (err) => {
  console.error('[redis] connection error:', err.message);
});

export async function pingRedis(): Promise<boolean> {
  try {
    const res = await redisClient.ping();
    return res === 'PONG';
  } catch {
    return false;
  }
}
