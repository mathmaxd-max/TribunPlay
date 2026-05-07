import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { consumeAuthAttempt, resetAuthAttempt } from "../lib/authRateLimit";
import { issueAuthSession, toAuthSessionHttpError } from "../lib/authSession";
import { toPasswordHttpError, validateEmail, validatePassword } from "../lib/password";
import { verifyPassword } from "../lib/password";
import { verifyTurnstile } from "../lib/turnstile";

const loginBodySchema = z.object({
  email: Str(),
  password: Str(),
  turnstileToken: Str({ required: false }),
});

export class AuthLogin extends OpenAPIRoute {
  schema = {
    tags: ["Auth"],
    summary: "Sign in with email/password",
    request: {
      body: {
        content: {
          "application/json": {
            schema: loginBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Returns authenticated identity and session",
        content: {
          "application/json": {
            schema: z.object({
              identity: z.object({
                mode: z.literal("token"),
                accountId: Str(),
                name: Str(),
                email: Str(),
              }),
              session: z.object({
                accessToken: Str(),
                refreshToken: Str(),
                expiresInSec: z.number(),
                expiresAtMs: z.number(),
              }),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
    const data = await this.getValidatedData<typeof this.schema>();

    let email: string;
    let password: string;

    try {
      email = validateEmail(data.body.email);
      password = validatePassword(data.body.password);
    } catch (error) {
      const normalized = toPasswordHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 500);
    }

    const clientIp = c.req.header("CF-Connecting-IP") ?? "unknown";
    const bucket = `login:${email}:${clientIp}`;
    const ipBucket = `login_ip:${clientIp}`;

    {
      const captcha = await verifyTurnstile({
        enabled: env.TURNSTILE_ENABLED === "true",
        secretKey: env.TURNSTILE_SECRET_KEY,
        token: data.body.turnstileToken,
        remoteIp: clientIp,
      });
      if (!captcha.success) {
        return c.json({ error: captcha.error }, 400);
      }
    }

    try {
      await consumeAuthAttempt(env.DB, bucket);
      // M01 additional non-invasive bot protection: a second per-IP bucket complements per-email+IP.
      await consumeAuthAttempt(env.DB, ipBucket);
    } catch {
      return c.json({ error: "Too many login attempts. Please try again later." }, 429);
    }

    const account = await env.DB
      .prepare(
        `SELECT a.id, a.name, a.email, ac.password_hash
         FROM accounts a
         INNER JOIN account_credentials ac ON ac.account_id = a.id
         WHERE lower(a.email) = ? AND a.provider = 'email'`
      )
      .bind(email)
      .first<{ id: string; name: string; email: string; password_hash: string }>();

    if (!account) {
      return c.json({ error: "Invalid email or password" }, 401);
    }

    const isValid = await verifyPassword(password, account.password_hash);
    if (!isValid) {
      return c.json({ error: "Invalid email or password" }, 401);
    }

    await resetAuthAttempt(env.DB, bucket);
    await resetAuthAttempt(env.DB, ipBucket);
    await env.DB
      .prepare("UPDATE account_credentials SET last_login_at = ?, updated_at = ? WHERE account_id = ?")
      .bind(new Date().toISOString(), new Date().toISOString(), account.id)
      .run();

    try {
      return await issueAuthSession({
        db: env.DB,
        tokenSecret: env.AUTH_TOKEN_SECRET,
        account: { id: account.id, name: account.name, email: account.email },
      });
    } catch (error) {
      const normalized = toAuthSessionHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 401 | 403 | 500 | 503);
    }
  }
}
