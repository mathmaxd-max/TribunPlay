import type { D1Database } from "@cloudflare/workers-types";

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

const ensureAuthRateLimitsTable = async (db: D1Database): Promise<void> => {
  // Local dev can run without migrations applied. If this table is missing, auth endpoints would
  // incorrectly return 429 on every attempt (because the SELECT throws and gets treated as "rate limited").
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS auth_rate_limits (
        bucket TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL,
        blocked_until TEXT,
        last_attempt_at TEXT NOT NULL
      )`
    )
    .run();
};

export const consumeAuthAttempt = async (db: D1Database, bucket: string): Promise<void> => {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  let existing:
    | { attempts: number; blocked_until: string | null; last_attempt_at: string }
    | null
    | undefined;
  try {
    existing = await db
      .prepare("SELECT attempts, blocked_until, last_attempt_at FROM auth_rate_limits WHERE bucket = ?")
      .bind(bucket)
      .first<{ attempts: number; blocked_until: string | null; last_attempt_at: string }>();
  } catch {
    await ensureAuthRateLimitsTable(db);
    existing = await db
      .prepare("SELECT attempts, blocked_until, last_attempt_at FROM auth_rate_limits WHERE bucket = ?")
      .bind(bucket)
      .first<{ attempts: number; blocked_until: string | null; last_attempt_at: string }>();
  }

  if (!existing) {
    await db
      .prepare(
        "INSERT INTO auth_rate_limits (bucket, attempts, blocked_until, last_attempt_at) VALUES (?, ?, NULL, ?)"
      )
      .bind(bucket, 1, nowIso)
      .run();
    return;
  }

  const blockedUntilMs = existing.blocked_until ? Date.parse(existing.blocked_until) : 0;
  if (blockedUntilMs > now) {
    throw new Error("Too many login attempts. Please try again later.");
  }

  const lastAttemptMs = Date.parse(existing.last_attempt_at);
  const attemptsInWindow = now - lastAttemptMs <= WINDOW_MS ? existing.attempts + 1 : 1;
  const nextBlockedUntil = attemptsInWindow >= MAX_ATTEMPTS ? new Date(now + BLOCK_MS).toISOString() : null;

  await db
    .prepare("UPDATE auth_rate_limits SET attempts = ?, blocked_until = ?, last_attempt_at = ? WHERE bucket = ?")
    .bind(attemptsInWindow, nextBlockedUntil, nowIso, bucket)
    .run();

  if (nextBlockedUntil) {
    throw new Error("Too many login attempts. Please try again later.");
  }
};

export const resetAuthAttempt = async (db: D1Database, bucket: string): Promise<void> => {
  try {
    await db.prepare("DELETE FROM auth_rate_limits WHERE bucket = ?").bind(bucket).run();
  } catch {
    // Keep reset best-effort in dev environments without migrations.
    await ensureAuthRateLimitsTable(db);
    await db.prepare("DELETE FROM auth_rate_limits WHERE bucket = ?").bind(bucket).run();
  }
};
