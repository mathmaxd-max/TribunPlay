import type { D1Database } from "@cloudflare/workers-types";
import {
  createAccessToken,
  createRefreshToken,
  hashRefreshToken,
  toAuthTokenHttpError,
  verifyAccessToken,
} from "./authTokens";

export type AuthIdentity = {
  mode: "token";
  accountId: string;
  name: string;
  email: string;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  expiresAtMs: number;
};

export type AuthSuccessResponse = {
  identity: AuthIdentity;
  session: AuthSession;
};

const createAuthIdentity = (account: { id: string; name: string; email: string }): AuthIdentity => ({
  mode: "token",
  accountId: account.id,
  name: account.name,
  email: account.email,
});

const insertRefreshToken = async (
  db: D1Database,
  accountId: string,
  refresh: { token: string; hash: string; expiresAtIso: string },
): Promise<{ refreshTokenId: string; refreshToken: string }> => {
  const refreshTokenId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO auth_refresh_tokens (id, account_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(refreshTokenId, accountId, refresh.hash, refresh.expiresAtIso, new Date().toISOString())
    .run();

  return { refreshTokenId, refreshToken: refresh.token };
};

export const issueAuthSession = async (params: {
  db: D1Database;
  tokenSecret: string | undefined;
  account: { id: string; name: string; email: string };
}): Promise<AuthSuccessResponse> => {
  const { db, tokenSecret, account } = params;
  const [access, refresh] = await Promise.all([
    createAccessToken({
      secret: tokenSecret,
      accountId: account.id,
      email: account.email,
      name: account.name,
    }),
    createRefreshToken(),
  ]);

  await insertRefreshToken(db, account.id, refresh);

  return {
    identity: createAuthIdentity(account),
    session: {
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresInSec: access.expiresInSec,
      expiresAtMs: access.expiresAtMs,
    },
  };
};

export const refreshAuthSession = async (params: {
  db: D1Database;
  tokenSecret: string | undefined;
  refreshToken: string;
}): Promise<AuthSuccessResponse> => {
  const { db, tokenSecret, refreshToken } = params;
  const refreshHash = await hashRefreshToken(refreshToken);
  const row = await db
    .prepare(
      `SELECT id, account_id, expires_at, revoked_at
       FROM auth_refresh_tokens
       WHERE token_hash = ?`
    )
    .bind(refreshHash)
    .first<{ id: string; account_id: string; expires_at: string; revoked_at: string | null }>();

  if (!row || row.revoked_at) {
    throw new Error("Invalid refresh token");
  }

  if (Date.parse(row.expires_at) <= Date.now()) {
    throw new Error("Refresh token expired");
  }

  const account = await db
    .prepare("SELECT id, name, email FROM accounts WHERE id = ? AND email IS NOT NULL")
    .bind(row.account_id)
    .first<{ id: string; name: string; email: string }>();

  if (!account) {
    throw new Error("Account not found");
  }

  const [access, refresh] = await Promise.all([
    createAccessToken({
      secret: tokenSecret,
      accountId: account.id,
      email: account.email,
      name: account.name,
    }),
    createRefreshToken(),
  ]);

  const replacementId = crypto.randomUUID();
  await db.batch([
    // Insert the replacement first so the FK in `replaced_by_token_id` can reference it.
    db
      .prepare(
        `INSERT INTO auth_refresh_tokens (id, account_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(replacementId, account.id, refresh.hash, refresh.expiresAtIso, new Date().toISOString()),
    db
      .prepare(
        `UPDATE auth_refresh_tokens
         SET revoked_at = ?, replaced_by_token_id = ?
         WHERE id = ?`
      )
      .bind(new Date().toISOString(), replacementId, row.id),
  ]);

  return {
    identity: createAuthIdentity(account),
    session: {
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresInSec: access.expiresInSec,
      expiresAtMs: access.expiresAtMs,
    },
  };
};

export const getAuthIdentityFromAccessToken = async (params: {
  db: D1Database;
  tokenSecret: string | undefined;
  accessToken: string;
}): Promise<AuthIdentity> => {
  const claims = await verifyAccessToken(params.tokenSecret, params.accessToken);
  const account = await params.db
    .prepare("SELECT id, name, email FROM accounts WHERE id = ? AND email IS NOT NULL")
    .bind(claims.accountId)
    .first<{ id: string; name: string; email: string }>();

  if (!account) {
    throw new Error("Account not found");
  }

  return createAuthIdentity(account);
};

export const revokeRefreshToken = async (db: D1Database, refreshToken: string): Promise<void> => {
  const refreshHash = await hashRefreshToken(refreshToken);
  await db
    .prepare("UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?")
    .bind(new Date().toISOString(), refreshHash)
    .run();
};

export const toAuthSessionHttpError = (error: unknown): { status: number; message: string } => {
  const fromToken = toAuthTokenHttpError(error);
  if (fromToken.status !== 500 || fromToken.message !== "Unknown auth token error") {
    return fromToken;
  }

  if (error instanceof Error) {
    if (error.message.toLowerCase().includes("refresh")) {
      return { status: 401, message: "Invalid or expired refresh token" };
    }
    if (error.message.toLowerCase().includes("account")) {
      return { status: 401, message: "Invalid authentication state" };
    }
    return { status: 500, message: error.message };
  }

  return { status: 500, message: "Unknown auth session error" };
};
