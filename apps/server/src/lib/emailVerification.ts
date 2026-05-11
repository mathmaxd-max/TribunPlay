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
): Promise<{ accountId: string }> => {
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT id, account_id, expires_at, consumed_at
       FROM auth_email_verifications
       WHERE token_hash = ?`
    )
    .bind(tokenHash)
    .first<{ id: string; account_id: string; expires_at: string; consumed_at: string | null }>();

  if (!row || row.consumed_at) {
    throw new Error("Invalid verification token");
  }

  if (Date.parse(row.expires_at) <= Date.now()) {
    throw new Error("Verification token expired");
  }

  const nowIso = new Date().toISOString();
  await db.batch([
    db
      .prepare("UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?")
      .bind(nowIso, row.account_id),
    db.prepare("UPDATE auth_email_verifications SET consumed_at = ? WHERE id = ?").bind(nowIso, row.id),
  ]);

  return { accountId: row.account_id };
};

