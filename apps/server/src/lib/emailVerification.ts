import type { D1Database } from "@cloudflare/workers-types";

const VERIFY_TOKEN_BYTES = 32;
const VERIFY_TOKEN_TTL_MS = 60 * 60 * 1000;

const encoder = new TextEncoder();

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

const sha256Hex = async (value: string): Promise<string> => {
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(new Uint8Array(hashBuffer));
};

const randomTokenHex = (byteCount: number): string => {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
};

export type EmailVerificationToken = {
  token: string;
  tokenHash: string;
  expiresAtIso: string;
};

export type ConsumeEmailVerificationResult =
  | { result: "verified"; accountId: string }
  | { result: "already_verified"; accountId: string }
  | { result: "invalid_or_expired" };

export const createEmailVerificationToken = async (
  db: D1Database,
  accountId: string,
): Promise<EmailVerificationToken> => {
  const token = randomTokenHex(VERIFY_TOKEN_BYTES);
  const tokenHash = await sha256Hex(token);
  const nowIso = new Date().toISOString();
  const expiresAtIso = new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString();

  await db
    .prepare(
      `INSERT INTO auth_email_verifications (id, account_id, token_hash, expires_at, created_at, consumed_at)
       VALUES (?, ?, ?, ?, ?, NULL)`
    )
    .bind(crypto.randomUUID(), accountId, tokenHash, expiresAtIso, nowIso)
    .run();

  return { token, tokenHash, expiresAtIso };
};

export const consumeEmailVerificationToken = async (
  db: D1Database,
  token: string,
): Promise<ConsumeEmailVerificationResult> => {
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT
         v.account_id,
         v.expires_at,
         v.consumed_at,
         a.email_verified_at,
         a.deleted_at
       FROM auth_email_verifications v
       INNER JOIN accounts a ON a.id = v.account_id
       WHERE v.token_hash = ?`
    )
    .bind(tokenHash)
    .first<{
      account_id: string;
      expires_at: string;
      consumed_at: string | null;
      email_verified_at: string | null;
      deleted_at: string | null;
    }>();

  if (!row || row.deleted_at) {
    return { result: "invalid_or_expired" };
  }

  if (row.consumed_at || Date.parse(row.expires_at) <= Date.now()) {
    if (row.email_verified_at) {
      return { result: "already_verified", accountId: row.account_id };
    }
    return { result: "invalid_or_expired" };
  }

  const nowIso = new Date().toISOString();
  if (row.email_verified_at) {
    await db
      .prepare("UPDATE auth_email_verifications SET consumed_at = COALESCE(consumed_at, ?) WHERE token_hash = ?")
      .bind(nowIso, tokenHash)
      .run();
    return { result: "already_verified", accountId: row.account_id };
  }

  await db.batch([
    db.prepare("UPDATE accounts SET email_verified_at = ? WHERE id = ?").bind(nowIso, row.account_id),
    db.prepare("UPDATE auth_email_verifications SET consumed_at = ? WHERE token_hash = ?").bind(nowIso, tokenHash),
  ]);

  return { result: "verified", accountId: row.account_id };
};
