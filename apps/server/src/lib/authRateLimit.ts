import type { D1Database } from "@cloudflare/workers-types";

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

export const consumeAuthAttempt = async (db: D1Database, bucket: string): Promise<void> => {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const existing = await db
    .prepare("SELECT attempts, blocked_until, last_attempt_at FROM auth_rate_limits WHERE bucket = ?")
    .bind(bucket)
    .first<{ attempts: number; blocked_until: string | null; last_attempt_at: string }>();

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
  await db.prepare("DELETE FROM auth_rate_limits WHERE bucket = ?").bind(bucket).run();
};
