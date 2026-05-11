import type { D1Database } from "@cloudflare/workers-types";

const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

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

export type PasswordResetToken = {
  token: string;
  expiresAtIso: string;
};

export type ConsumePasswordResetResult =
  | { result: "ok"; accountId: string }
  | { result: "invalid_or_expired" };

export const createPasswordResetToken = async (
  db: D1Database,
  accountId: string,
): Promise<PasswordResetToken> => {
  const token = randomTokenHex(RESET_TOKEN_BYTES);
  const tokenHash = await sha256Hex(token);
  const nowIso = new Date().toISOString();
  const expiresAtIso = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();

  await db
    .prepare(
      `INSERT INTO auth_password_resets (id, account_id, token_hash, expires_at, created_at, consumed_at)
       VALUES (?, ?, ?, ?, ?, NULL)`
    )
    .bind(crypto.randomUUID(), accountId, tokenHash, expiresAtIso, nowIso)
    .run();

  return { token, expiresAtIso };
};

export const consumePasswordResetToken = async (
  db: D1Database,
  token: string,
): Promise<ConsumePasswordResetResult> => {
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT
         r.id,
         r.account_id,
         r.expires_at,
         r.consumed_at,
         a.deleted_at
       FROM auth_password_resets r
       INNER JOIN accounts a ON a.id = r.account_id
       WHERE r.token_hash = ?`
    )
    .bind(tokenHash)
    .first<{
      id: string;
      account_id: string;
      expires_at: string;
      consumed_at: string | null;
      deleted_at: string | null;
    }>();

  if (!row || row.deleted_at || row.consumed_at) {
    return { result: "invalid_or_expired" };
  }

  if (Date.parse(row.expires_at) <= Date.now()) {
    return { result: "invalid_or_expired" };
  }

  const nowIso = new Date().toISOString();
  await db
    .prepare("UPDATE auth_password_resets SET consumed_at = ? WHERE id = ?")
    .bind(nowIso, row.id)
    .run();

  return { result: "ok", accountId: row.account_id };
};

export const revokePasswordResetTokensForAccount = async (db: D1Database, accountId: string): Promise<void> => {
  await db
    .prepare("UPDATE auth_password_resets SET consumed_at = COALESCE(consumed_at, ?) WHERE account_id = ?")
    .bind(new Date().toISOString(), accountId)
    .run();
};
