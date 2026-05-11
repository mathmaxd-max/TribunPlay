import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { consumeAuthAttempt, isAuthRateLimitError, resetAuthAttempt } from "../lib/authRateLimit";
import { issueAuthSession, toAuthSessionHttpError } from "../lib/authSession";
import { toPasswordHttpError, validateEmail, validatePassword } from "../lib/password";
import { verifyPassword } from "../lib/password";
import { resolveTurnstileServerConfig, verifyTurnstile } from "../lib/turnstile";

const loginBodySchema = z.object({
  email: Str(),
  password: Str(),
  // Older clients may send `turnstileToken: null` when CAPTCHA is disabled.
  // Treat null as "missing" so request validation doesn't hard-fail with 400.
  turnstileToken: z.preprocess((value) => (value === null ? undefined : value), Str({ required: false })),
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
    const turnstileConfig = resolveTurnstileServerConfig({
      enabledFlag: env.TURNSTILE_ENABLED,
      configuredSecretKey: env.TURNSTILE_SECRET_KEY,
      requestUrl: c.req.url,
      hostHeader: c.req.header("Host") ?? undefined,
    });
    const bucket = `login:${email}:${clientKey}`;
    const ipBucket = `login_ip:${clientKey}`;

    {
      const captcha = await verifyTurnstile({
        enabled: turnstileConfig.enabled,
        secretKey: turnstileConfig.secretKey,
        token: data.body.turnstileToken,
        remoteIp: clientIp,
      });
      if (captcha.success === false) {
        return c.json({ error: captcha.error }, 400);
      }
    }

    if (!turnstileConfig.isLocalDevHost) {
      try {
        await consumeAuthAttempt(env.DB, bucket);
        // M01 additional non-invasive bot protection: a second per-IP bucket complements per-email+IP.
        await consumeAuthAttempt(env.DB, ipBucket);
      } catch (error) {
        if (isAuthRateLimitError(error)) {
          c.header("Retry-After", String(error.retryAfterSec));
          return c.json({ error: "Too many login attempts. Please try again later." }, 429);
        }
        console.error("Login rate-limit check failed", error);
        return c.json({ error: "Unable to process login right now. Please try again shortly." }, 503);
      }
    }

    const account = await env.DB
      .prepare(
        `SELECT a.id, a.name, a.email, a.email_verified_at, ac.password_hash
         FROM accounts a
         INNER JOIN account_credentials ac ON ac.account_id = a.id
         WHERE lower(a.email) = ? AND a.provider = 'email'`
      )
      .bind(email)
      .first<{ id: string; name: string; email: string; email_verified_at: string | null; password_hash: string }>();

    if (!account) {
      return c.json({ error: "Invalid email or password" }, 401);
    }

    const isValid = await verifyPassword(password, account.password_hash);
    if (!isValid) {
      return c.json({ error: "Invalid email or password" }, 401);
    }

    if (!account.email_verified_at) {
      return c.json({ error: "Please verify your email before logging in." }, 403);
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
