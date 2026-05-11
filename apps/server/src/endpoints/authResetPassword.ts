import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { hashPassword, toPasswordHttpError, validatePassword } from "../lib/password";
import { consumePasswordResetToken, revokePasswordResetTokensForAccount } from "../lib/passwordReset";
import { revokeAllRefreshTokensForAccount } from "../lib/authSession";

const resetPasswordBodySchema = z.object({
  token: Str(),
  newPassword: Str(),
});

export class AuthResetPassword extends OpenAPIRoute {
  schema = {
    tags: ["Auth"],
    summary: "Reset password using a one-time email token",
    request: {
      body: {
        content: {
          "application/json": {
            schema: resetPasswordBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Password reset result",
        content: {
          "application/json": {
            schema: z.object({ success: z.boolean() }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
    const data = await this.getValidatedData<typeof this.schema>();

    let newPassword: string;
    try {
      newPassword = validatePassword(data.body.newPassword);
    } catch (error) {
      const normalized = toPasswordHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 500);
    }

    const consumed = await consumePasswordResetToken(env.DB, data.body.token);
    if (consumed.result !== "ok") {
      return c.json({ error: "Invalid or expired password reset link" }, 400);
    }

    const credential = await env.DB
      .prepare(
        `SELECT ac.account_id
         FROM account_credentials ac
         INNER JOIN accounts a ON a.id = ac.account_id
         WHERE ac.account_id = ? AND a.provider = 'email' AND a.deleted_at IS NULL`
      )
      .bind(consumed.accountId)
      .first<{ account_id: string }>();

    if (!credential) {
      return c.json({ error: "Invalid or expired password reset link" }, 400);
    }

    try {
      const nowIso = new Date().toISOString();
      const passwordHash = await hashPassword(newPassword);
      await env.DB
        .prepare("UPDATE account_credentials SET password_hash = ?, updated_at = ? WHERE account_id = ?")
        .bind(passwordHash, nowIso, consumed.accountId)
        .run();
      await revokeAllRefreshTokensForAccount(env.DB, consumed.accountId);
      await revokePasswordResetTokensForAccount(env.DB, consumed.accountId);
      return { success: true };
    } catch (error) {
      const normalized = toPasswordHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 500);
    }
  }
}
