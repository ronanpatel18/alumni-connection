/**
 * Rate limiting (adapted from conference-connection's lib/rate-limit.ts).
 *
 * Uses Upstash Redis when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are
 * set (production) and an in-memory store otherwise (local development).
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { type NextRequest, NextResponse } from "next/server";

interface RateLimitConfig {
  /** Maximum requests per window */
  limit: number;
  /** Window size in seconds */
  windowSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

// ---------------------------------------------------------------------------
// Client IP extraction
// ---------------------------------------------------------------------------

export function getClientIP(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const ip = forwardedFor.split(",")[0]?.trim();
    if (ip) return ip;
  }
  return headers.get("cf-connecting-ip") ?? headers.get("x-real-ip") ?? "unknown";
}

// ---------------------------------------------------------------------------
// Upstash Redis rate limiter (production)
// ---------------------------------------------------------------------------

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
    : null;

const upstashLimiters = new Map<string, Ratelimit>();

function getUpstashLimiter(name: string, config: RateLimitConfig) {
  if (!redis) return null;
  let limiter = upstashLimiters.get(name);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(config.limit, `${config.windowSec} s`),
      analytics: true,
      prefix: "rl",
    });
    upstashLimiters.set(name, limiter);
  }
  return limiter;
}

// ---------------------------------------------------------------------------
// In-memory fallback rate limiter (development only)
// ---------------------------------------------------------------------------

const memoryStore = new Map<string, { count: number; resetAt: number }>();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function checkInMemory(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
    lastCleanup = now;
    for (const [k, entry] of memoryStore) if (entry.resetAt < now) memoryStore.delete(k);
  }

  const entry = memoryStore.get(key);
  if (!entry || entry.resetAt < now) {
    const resetAt = now + config.windowSec * 1000;
    memoryStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: config.limit - 1, resetAt };
  }
  if (entry.count >= config.limit) return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  entry.count++;
  return { allowed: true, remaining: config.limit - entry.count, resetAt: entry.resetAt };
}

// ---------------------------------------------------------------------------
// Unified API
// ---------------------------------------------------------------------------

export async function checkRateLimit(name: string, key: string, config: RateLimitConfig): Promise<RateLimitResult> {
  const upstash = getUpstashLimiter(name, config);
  if (upstash) {
    const { success, remaining, reset } = await upstash.limit(`${name}:${key}`);
    return { allowed: success, remaining, resetAt: reset };
  }
  return checkInMemory(`${name}:${key}`, config);
}

function blockedResponse(config: RateLimitConfig, result: RateLimitResult) {
  const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { success: false, error: "Too many requests", retryAfter: retryAfterSec },
    {
      status: 429,
      headers: {
        "X-RateLimit-Limit": String(config.limit),
        "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
        "Retry-After": String(retryAfterSec),
      },
    },
  );
}

/** Route-handler guard: returns a 429 response when the caller's IP is over the limit, else null. */
export function rateLimit(name: string, config: RateLimitConfig) {
  return async function guard(req: NextRequest): Promise<NextResponse | null> {
    const result = await checkRateLimit(name, getClientIP(req.headers), config);
    return result.allowed ? null : blockedResponse(config, result);
  };
}

export const LIMITS = {
  /** Standard API endpoint */
  standard: { limit: 30, windowSec: 60 },
  /** Auth and other sensitive actions */
  strict: { limit: 10, windowSec: 60 },
  /** AI or otherwise expensive operations */
  expensive: { limit: 5, windowSec: 60 },
  /** Directory searches (also caps bulk scraping of contact details) */
  search: { limit: 60, windowSec: 60 },
  /** AI calls behind a prompt search (interpreting it, ordering the shortlist). Over the limit, search falls back to rules. */
  aiSearch: { limit: 12, windowSec: 60 },
} as const;

export const rateLimiters = {
  standard: rateLimit("standard", LIMITS.standard),
  strict: rateLimit("strict", LIMITS.strict),
  expensive: rateLimit("expensive", LIMITS.expensive),
  search: rateLimit("search", LIMITS.search),
};
