import type { D1Database } from "@cloudflare/workers-types";

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

const AUTH_RATE_LIMITS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  blocked_until TEXT,
  last_attempt_at TEXT NOT NULL
)`;

export class AuthRateLimitError extends Error {
  readonly retryAfterSec: number;

  constructor(retryAfterSec: number) {
    super("Too many authentication attempts. Please try again later.");
    this.name = "AuthRateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

export const isAuthRateLimitError = (error: unknown): error is AuthRateLimitError =>
  error instanceof AuthRateLimitError;

const ensureAuthRateLimitsTable = async (db: D1Database): Promise<void> => {
  // Local dev can run without migrations applied. If this table is missing, auth endpoints would
  // incorrectly return 429 on every attempt (because the SELECT throws and gets treated as "rate limited").
  await db.prepare(AUTH_RATE_LIMITS_TABLE_SQL).run();

  // Self-heal older/invalid schemas: limiter state is ephemeral, so rebuilding is safe.
  const schema = await db.prepare("PRAGMA table_info(auth_rate_limits)").all<{ name: string }>();
  const columns = new Set((schema.results ?? []).map((row) => row.name));
  const hasRequiredColumns =
    columns.has("bucket") && columns.has("attempts") && columns.has("blocked_until") && columns.has("last_attempt_at");
  if (hasRequiredColumns) return;

  await db.prepare("DROP TABLE IF EXISTS auth_rate_limits").run();
  await db.prepare(AUTH_RATE_LIMITS_TABLE_SQL).run();
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

  const blockedUntilMs = existing.blocked_until ? Date.parse(existing.blocked_until) : Number.NaN;
  if (Number.isFinite(blockedUntilMs) && blockedUntilMs > now) {
    throw new AuthRateLimitError(Math.max(1, Math.ceil((blockedUntilMs - now) / 1000)));
  }

  const lastAttemptMs = Date.parse(existing.last_attempt_at);
  const priorAttempts = Number.isFinite(existing.attempts) && existing.attempts > 0 ? existing.attempts : 0;
  const attemptsInWindow =
    Number.isFinite(lastAttemptMs) && now - lastAttemptMs <= WINDOW_MS ? priorAttempts + 1 : 1;
  const nextBlockedUntil = attemptsInWindow >= MAX_ATTEMPTS ? new Date(now + BLOCK_MS).toISOString() : null;

  await db
    .prepare("UPDATE auth_rate_limits SET attempts = ?, blocked_until = ?, last_attempt_at = ? WHERE bucket = ?")
    .bind(attemptsInWindow, nextBlockedUntil, nowIso, bucket)
    .run();

  if (nextBlockedUntil) {
    throw new AuthRateLimitError(Math.max(1, Math.ceil(BLOCK_MS / 1000)));
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
