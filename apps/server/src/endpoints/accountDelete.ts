import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { getAuthIdentityFromAccessToken, toAuthSessionHttpError } from "../lib/authSession";
import { revokePasswordResetTokensForAccount } from "../lib/passwordReset";

const parseBearerToken = (headerValue: string | undefined): string | null => {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
};

export class AccountDelete extends OpenAPIRoute {
  schema = {
    tags: ["Account"],
    summary: "Delete the authenticated account",
    responses: {
      "200": {
        description: "Deletion result",
        content: {
          "application/json": {
            schema: z.object({ success: z.boolean() }),
          },
        },
      },
      "401": { description: "Unauthorized" },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;

    const accessToken = parseBearerToken(c.req.header("Authorization"));
    if (!accessToken) {
      return c.json({ error: "Missing bearer token" }, 401);
    }

    let identity;
    try {
      identity = await getAuthIdentityFromAccessToken({
        db: env.DB,
        tokenSecret: env.AUTH_TOKEN_SECRET,
        accessToken,
      });
    } catch (error) {
      const normalized = toAuthSessionHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 401 | 500);
    }

    const account = await env.DB
      .prepare(
        `SELECT id, provider
         FROM accounts
         WHERE id = ? AND deleted_at IS NULL`
      )
      .bind(identity.accountId)
      .first<{ id: string; provider: "guest" | "google" | "email" }>();

    if (!account) {
      return c.json({ error: "Account not found" }, 404);
    }

    if (account.provider === "guest") {
      return c.json({ error: "Guest accounts cannot be deleted via this endpoint." }, 403);
    }

    const nowIso = new Date().toISOString();

    await env.DB.batch([
      env.DB
        .prepare("UPDATE accounts SET deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(nowIso, nowIso, account.id),
      env.DB
        .prepare("UPDATE game_participants SET deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE account_id = ?")
        .bind(nowIso, nowIso, account.id),
      env.DB
        .prepare("DELETE FROM setup_library_items WHERE account_id = ?")
        .bind(account.id),
      env.DB
        .prepare("UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE account_id = ?")
        .bind(nowIso, account.id),
      env.DB
        .prepare("UPDATE auth_email_verifications SET consumed_at = COALESCE(consumed_at, ?) WHERE account_id = ?")
        .bind(nowIso, account.id),
    ]);

    await revokePasswordResetTokensForAccount(env.DB, account.id);

    return { success: true };
  }
}
