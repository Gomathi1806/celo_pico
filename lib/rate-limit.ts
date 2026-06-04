import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "./upstash";

const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 10);
const RATE_LIMIT_WINDOW = Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60);
const DAILY_SPEND_CAP_USD = Number(process.env.DAILY_SPEND_CAP_USD ?? 1.0);

let _ratelimit: Ratelimit | null = null;

function getRatelimit(): Ratelimit | null {
  if (_ratelimit) return _ratelimit;
  const redis = getRedis();
  if (!redis) return null;
  _ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(
      RATE_LIMIT_MAX,
      `${RATE_LIMIT_WINDOW} s`,
    ),
    prefix: "pico:rl",
    analytics: false,
  });
  return _ratelimit;
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; status: 429; message: string };

/**
 * Two-stage gate per identifier (FID or IP):
 *   1. Sliding-window rate limit (prevents burst abuse).
 *   2. Daily USD spend cap (prevents slow-drip botnet).
 *
 * Without Upstash configured, both are no-ops — useful for local dev but
 * NEVER ship to production without Upstash provisioned.
 */
export async function checkRateLimitAndSpend(
  identifier: string,
  priceUsd: number,
): Promise<RateLimitResult> {
  const rl = getRatelimit();
  const redis = getRedis();
  if (!rl || !redis) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[pico] rate limiting DISABLED — UPSTASH_REDIS_REST_URL not set in production",
      );
    }
    return { allowed: true };
  }

  // Stage 1: sliding window
  const { success, limit, reset } = await rl.limit(identifier);
  if (!success) {
    const retryInSec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    return {
      allowed: false,
      status: 429,
      message: `Rate limit hit (${limit} per ${RATE_LIMIT_WINDOW}s). Try again in ${retryInSec}s.`,
    };
  }

  // Stage 2: daily spend cap (track in cents to avoid float issues)
  const today = new Date().toISOString().slice(0, 10);
  const key = `pico:spend:${identifier}:${today}`;
  const cents = Math.round(priceUsd * 100);
  const newTotalCents = await redis.incrby(key, cents);
  if (newTotalCents === cents) {
    // First call of the day — set TTL to 25h so it expires after midnight UTC
    await redis.expire(key, 60 * 60 * 25);
  }
  if (newTotalCents > DAILY_SPEND_CAP_USD * 100) {
    return {
      allowed: false,
      status: 429,
      message: `Daily spend cap of $${DAILY_SPEND_CAP_USD.toFixed(
        2,
      )} reached. Resets at midnight UTC.`,
    };
  }

  return { allowed: true };
}
