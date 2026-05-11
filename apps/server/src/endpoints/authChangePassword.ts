import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { getAuthIdentityFromAccessToken, revokeAllRefreshTokensForAccount, toAuthSessionHttpError } from "../lib/authSession";
import {
  hashPassword,
  toPasswordHttpError,
  validatePassword,
  verifyPassword,
} from "../lib/password";

const changePasswordBodySchema = z.object({
  currentPassword: Str(),
  newPassword: Str(),
});

const parseBearerToken = (headerValue: string | undefined): string | null => {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
};

export class AuthChangePassword extends OpenAPIRoute {
  schema = {
    tags: ["Auth"],
    summary: "Change password for the authenticated account",
    request: {
      body: {
        content: {
          "application/json": {
            schema: changePasswordBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Password updated",
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
    const data = await this.getValidatedData<typeof this.schema>();

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

    let currentPassword: string;
    let newPassword: string;
    try {
      currentPassword = validatePassword(data.body.currentPassword);
      newPassword = validatePassword(data.body.newPassword);
    } catch (error) {
      const normalized = toPasswordHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 500);
    }

    const credential = await env.DB
      .prepare(
        `SELECT ac.password_hash
         FROM account_credentials ac
         INNER JOIN accounts a ON a.id = ac.account_id
         WHERE ac.account_id = ? AND a.provider = 'email' AND a.deleted_at IS NULL`
      )
      .bind(identity.accountId)
      .first<{ password_hash: string }>();

    if (!credential) {
      return c.json({ error: "Password change is only available for email accounts." }, 403);
    }

    const currentMatches = await verifyPassword(currentPassword, credential.password_hash);
    if (!currentMatches) {
      return c.json({ error: "Current password is incorrect." }, 401);
    }

    const sameAsCurrent = await verifyPassword(newPassword, credential.password_hash);
    if (sameAsCurrent) {
      return c.json({ error: "New password must be different from the current password." }, 400);
    }

    try {
      const nowIso = new Date().toISOString();
      const passwordHash = await hashPassword(newPassword);
      await env.DB
        .prepare("UPDATE account_credentials SET password_hash = ?, updated_at = ? WHERE account_id = ?")
        .bind(passwordHash, nowIso, identity.accountId)
        .run();
      await revokeAllRefreshTokensForAccount(env.DB, identity.accountId);
      return { success: true };
    } catch (error) {
      const normalized = toPasswordHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 500);
    }
  }
}
