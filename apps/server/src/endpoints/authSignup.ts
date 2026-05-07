import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { issueAuthSession, toAuthSessionHttpError } from "../lib/authSession";
import {
  hashPassword,
  toPasswordHttpError,
  validateAccountName,
  validateEmail,
  validatePassword,
} from "../lib/password";
import { verifyTurnstile } from "../lib/turnstile";
import { consumeAuthAttempt, resetAuthAttempt } from "../lib/authRateLimit";

const signupBodySchema = z.object({
  email: Str(),
  password: Str(),
  name: Str(),
  turnstileToken: Str({ required: false }),
});

export class AuthSignup extends OpenAPIRoute {
  schema = {
    tags: ["Auth"],
    summary: "Create an email/password account",
    request: {
      body: {
        content: {
          "application/json": {
            schema: signupBodySchema,
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
    let name: string;

    try {
      email = validateEmail(data.body.email);
      password = validatePassword(data.body.password);
      name = validateAccountName(data.body.name);
    } catch (error) {
      const normalized = toPasswordHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 500);
    }

    const forwardedFor = c.req.header("X-Forwarded-For") ?? c.req.header("x-forwarded-for");
    const realIp = c.req.header("X-Real-IP") ?? c.req.header("x-real-ip");
    const clientIp =
      c.req.header("CF-Connecting-IP") ??
      forwardedFor?.split(",")[0]?.trim() ??
      realIp ??
      "unknown";
    const clientKey =
      clientIp !== "unknown"
        ? clientIp
        : `ua:${(c.req.header("User-Agent") ?? "unknown").slice(0, 120)}`;

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

    // In local dev (`wrangler dev`) `CF-Connecting-IP` is often absent; using a hardcoded
    // "unknown" would make every signup share the same global bucket and immediately hit 429.
    const bucket = `signup:${email}:${clientKey}`;
    const ipBucket = `signup_ip:${clientKey}`;
    try {
      await consumeAuthAttempt(env.DB, bucket);
      // M01 additional non-invasive bot protection: a second per-IP bucket complements per-email+IP.
      await consumeAuthAttempt(env.DB, ipBucket);
    } catch {
      return c.json({ error: "Too many signup attempts. Please try again later." }, 429);
    }

    const existing = await env.DB
      .prepare("SELECT id FROM accounts WHERE lower(email) = ? AND provider IN ('email', 'google')")
      .bind(email)
      .first<{ id: string }>();

    if (existing?.id) {
      return c.json({ error: "Unable to create account" }, 409);
    }

    try {
      const nowIso = new Date().toISOString();
      const accountId = crypto.randomUUID();
      const passwordHash = await hashPassword(password);

      await env.DB.batch([
        env.DB
          .prepare(
            `INSERT INTO accounts (id, provider, provider_subject, name, email, created_at, updated_at)
             VALUES (?, 'email', NULL, ?, ?, ?, ?)`
          )
          .bind(accountId, name, email, nowIso, nowIso),
        env.DB
          .prepare(
            `INSERT INTO account_credentials (account_id, password_hash, hash_algo, created_at, updated_at, last_login_at)
             VALUES (?, ?, 'bcrypt', ?, ?, ?)`
          )
          .bind(accountId, passwordHash, nowIso, nowIso, nowIso),
      ]);

      await resetAuthAttempt(env.DB, bucket);
      await resetAuthAttempt(env.DB, ipBucket);
      return issueAuthSession({
        db: env.DB,
        tokenSecret: env.AUTH_TOKEN_SECRET,
        account: { id: accountId, name, email },
      });
    } catch (error) {
      const normalized = toAuthSessionHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 401 | 403 | 500 | 503);
    }
  }
}
