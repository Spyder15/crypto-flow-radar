import { redisClient } from './client';
import { AggregatedHotel } from '../types';

const TTL_SECONDS = 60 * 10; // cached aggregation expires after 10 minutes

function zsetKey(city: string): string {
  return `hotels:${city.toLowerCase()}:zset`;
}

function hashKey(city: string, name: string): string {
  return `hotels:${city.toLowerCase()}:hash:${name}`;
}

/**
 * Persists the de-duplicated hotel list for a city into Redis:
 * - A sorted set (score = price) keyed by city, used for ZRANGEBYSCORE price filtering.
 * - A hash per hotel holding the full record (supplier, commissionPct, etc.).
 */
export async function saveHotelsToRedis(city: string, hotels: AggregatedHotel[]): Promise<void> {
  const zKey = zsetKey(city);
  const pipeline = redisClient.pipeline();

  pipeline.del(zKey);
  for (const hotel of hotels) {
    pipeline.zadd(zKey, hotel.price, hotel.name);
    pipeline.hset(hashKey(city, hotel.name), {
      name: hotel.name,
      price: String(hotel.price),
      supplier: hotel.supplier,
      commissionPct: String(hotel.commissionPct),
    });
    pipeline.expire(hashKey(city, hotel.name), TTL_SECONDS);
  }
  pipeline.expire(zKey, TTL_SECONDS);

  const results = await pipeline.exec();
  const failed = (results || []).find(([err]) => err);
  if (failed) {
    throw failed[0];
  }
}

/**
 * Reads hotels for a city from Redis, optionally filtered by price range
 * using ZRANGEBYSCORE so the filtering happens inside Redis itself.
 */
export async function getHotelsFromRedis(
  city: string,
  minPrice?: number,
  maxPrice?: number
): Promise<AggregatedHotel[]> {
  const zKey = zsetKey(city);
  const min = minPrice !== undefined ? minPrice : '-inf';
  const max = maxPrice !== undefined ? maxPrice : '+inf';

  const names = await redisClient.zrangebyscore(zKey, min, max);
  if (names.length === 0) return [];

  const pipeline = redisClient.pipeline();
  for (const name of names) {
    pipeline.hgetall(hashKey(city, name));
  }
  const results = await pipeline.exec();

  const hotels: AggregatedHotel[] = [];
  for (const [err, data] of results || []) {
    if (err || !data || Object.keys(data as object).length === 0) continue;
    const record = data as Record<string, string>;
    hotels.push({
      name: record.name,
      price: Number(record.price),
      supplier: record.supplier,
      commissionPct: Number(record.commissionPct),
    });
  }
  return hotels;
}
