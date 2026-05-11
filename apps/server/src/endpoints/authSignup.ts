import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { toAuthSessionHttpError } from "../lib/authSession";
import {
  hashPassword,
  toPasswordHttpError,
  validateAccountName,
  validateEmail,
  validatePassword,
} from "../lib/password";
import { resolveTurnstileServerConfig, verifyTurnstile } from "../lib/turnstile";
import { consumeAuthAttempt, isAuthRateLimitError, resetAuthAttempt } from "../lib/authRateLimit";
import { createEmailVerificationToken } from "../lib/emailVerification";
import { sendResendEmail } from "../lib/emailSender";

const signupBodySchema = z.object({
  email: Str(),
  password: Str(),
  name: Str(),
  // Older clients may send `turnstileToken: null` when CAPTCHA is disabled.
  // Treat null as "missing" so request validation doesn't hard-fail with 400.
  turnstileToken: z.preprocess((value) => (value === null ? undefined : value), Str({ required: false })),
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
        description: "Account created; email verification required before login",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              requiresEmailVerification: z.boolean(),
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
    const turnstileConfig = resolveTurnstileServerConfig({
      enabledFlag: env.TURNSTILE_ENABLED,
      configuredSecretKey: env.TURNSTILE_SECRET_KEY,
      requestUrl: c.req.url,
      hostHeader: c.req.header("Host") ?? undefined,
    });

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

    // In local dev (`wrangler dev`) `CF-Connecting-IP` is often absent; using a hardcoded
    // "unknown" would make every signup share the same global bucket and immediately hit 429.
    const bucket = `signup:${email}:${clientKey}`;
    const ipBucket = `signup_ip:${clientKey}`;
    if (!turnstileConfig.isLocalDevHost) {
      try {
        await consumeAuthAttempt(env.DB, bucket);
        // M01 additional non-invasive bot protection: a second per-IP bucket complements per-email+IP.
        await consumeAuthAttempt(env.DB, ipBucket);
      } catch (error) {
        if (isAuthRateLimitError(error)) {
          c.header("Retry-After", String(error.retryAfterSec));
          return c.json({ error: "Too many signup attempts. Please try again later." }, 429);
        }
        console.error("Signup rate-limit check failed", error);
        return c.json({ error: "Unable to process signup right now. Please try again shortly." }, 503);
      }
    }

    const existing = await env.DB
      .prepare(
        `SELECT id, provider, email_verified_at
         FROM accounts
         WHERE lower(email) = ? AND provider IN ('email', 'google') AND email IS NOT NULL`
      )
      .bind(email)
      .first<{ id: string; provider: "email" | "google"; email_verified_at: string | null }>();

    // If an email/password account exists but isn't verified yet, behave like a signup:
    // re-send verification and return the normal "requiresEmailVerification" response.
    if (existing?.id && existing.provider === "email" && !existing.email_verified_at) {
      try {
        const { token } = await createEmailVerificationToken(env.DB, existing.id);
        const baseUrl = env.APP_BASE_URL ?? "https://tribun-ppc.com";
        const verifyUrl = new URL("/verify-email", baseUrl);
        verifyUrl.searchParams.set("token", token);

        await sendResendEmail({
          apiKey: env.RESEND_API_KEY,
          from: env.EMAIL_FROM,
          to: email,
          subject: "Verify your email for TribunPlay",
          text: `Welcome back!\n\nVerify your email to finish signing up:\n\n${verifyUrl.toString()}\n\nIf you didn’t request this, you can ignore this email.`,
          html: `<p>Welcome back!</p><p>Verify your email to finish signing up:</p><p><a href="${verifyUrl.toString()}">Verify email</a></p><p>If you didn’t request this, you can ignore this email.</p>`,
        });

        return { success: true, requiresEmailVerification: true };
      } catch (error) {
        const normalized = toAuthSessionHttpError(error);
        return c.json({ error: normalized.message }, normalized.status as 400 | 401 | 403 | 500 | 503);
      }
    }

    if (existing?.id) {
      // Provide a user-facing message; avoid vague "Unable to create account".
      // Do not leak whether the account is Google vs email beyond this stable hint.
      return c.json({ error: "An account with this email already exists. Please log in instead." }, 409);
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

      // Email verification
      const { token } = await createEmailVerificationToken(env.DB, accountId);
      const baseUrl = env.APP_BASE_URL ?? "https://tribun-ppc.com";
      const verifyUrl = new URL("/verify-email", baseUrl);
      verifyUrl.searchParams.set("token", token);

      await sendResendEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.EMAIL_FROM,
        to: email,
        subject: "Verify your email for TribunPlay",
        text: `Welcome to TribunPlay!\n\nVerify your email to finish signing up:\n\n${verifyUrl.toString()}\n\nIf you didn’t request this, you can ignore this email.`,
        html: `<p>Welcome to TribunPlay!</p><p>Verify your email to finish signing up:</p><p><a href="${verifyUrl.toString()}">Verify email</a></p><p>If you didn’t request this, you can ignore this email.</p>`,
      });

      return { success: true, requiresEmailVerification: true };
    } catch (error) {
      const normalized = toAuthSessionHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 401 | 403 | 500 | 503);
    }
  }
}
