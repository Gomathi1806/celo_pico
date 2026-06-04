import { Redis } from "@upstash/redis";

/**
 * Singleton Redis client. Uses Vercel/Upstash REST creds when present,
 * returns null otherwise so the app keeps working in environments without
 * Upstash configured (e.g. local dev before provisioning).
 *
 * Provision via Vercel Marketplace → Upstash for Redis. After provisioning,
 * `vercel env pull .env.local` brings the credentials in.
 */
let _redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

export const HAS_UPSTASH = (): boolean =>
  Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
