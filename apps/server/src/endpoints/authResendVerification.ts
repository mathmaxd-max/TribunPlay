import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { validateEmail } from "../lib/password";
import { resolveTurnstileServerConfig, verifyTurnstile } from "../lib/turnstile";
import { consumeAuthAttempt, isAuthRateLimitError } from "../lib/authRateLimit";
import { createEmailVerificationToken } from "../lib/emailVerification";
import { sendResendEmail } from "../lib/emailSender";

const resendVerificationBodySchema = z.object({
  email: Str(),
  // Older clients may send `turnstileToken: null` when CAPTCHA is disabled.
  // Treat null as "missing" so request validation doesn't hard-fail with 400.
  turnstileToken: z.preprocess((value) => (value === null ? undefined : value), Str({ required: false })),
});

const resendVerificationResponseSchema = z.object({
  success: z.boolean(),
  result: z.enum(["sent", "already_verified", "accepted"]),
});

export class AuthResendVerification extends OpenAPIRoute {
  schema = {
    tags: ["Auth"],
    summary: "Resend email verification link (email/password accounts)",
    request: {
      body: {
        content: {
          "application/json": {
            schema: resendVerificationBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Resend verification result",
        content: {
          "application/json": {
            schema: resendVerificationResponseSchema,
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
    const data = await this.getValidatedData<typeof this.schema>();

    const ok = (result: "sent" | "already_verified" | "accepted") => ({ success: true, result });

    let email: string;
    try {
      email = validateEmail(data.body.email, env.ALLOWED_EMAIL_DOMAINS);
    } catch {
      return ok("accepted");
    }

    const clientIp = c.req.header("CF-Connecting-IP") ?? "unknown";

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

    if (!turnstileConfig.isLocalDevHost) {
      try {
        await consumeAuthAttempt(env.DB, `resend_verify:${email}:${clientIp}`);
        await consumeAuthAttempt(env.DB, `resend_verify_ip:${clientIp}`);
      } catch (error) {
        if (isAuthRateLimitError(error)) {
          c.header("Retry-After", String(error.retryAfterSec));
          return c.json({ error: "Too many resend attempts. Please try again later." }, 429);
        }
        console.error("Resend verification rate-limit check failed", error);
        return c.json({ error: "Unable to process the request right now. Please try again shortly." }, 503);
      }
    }

    const account = await env.DB
      .prepare(
        `SELECT id, email_verified_at
         FROM accounts
         WHERE lower(email) = ? AND provider = 'email' AND email IS NOT NULL AND deleted_at IS NULL`
      )
      .bind(email)
      .first<{ id: string; email_verified_at: string | null }>();

    if (!account) {
      return ok("accepted");
    }

    if (account.email_verified_at) {
      return ok("already_verified");
    }

    try {
      const { token } = await createEmailVerificationToken(env.DB, account.id);

      const baseUrl = env.APP_BASE_URL ?? "https://tribun-ppc.com";
      const verifyUrl = new URL("/verify-email", baseUrl);
      verifyUrl.searchParams.set("token", token);

      await sendResendEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.EMAIL_FROM,
        to: email,
        subject: "Verify your email for TribunPlay",
        text: `Verify your email to finish signing up:\n\n${verifyUrl.toString()}\n\nIf you didn’t request this, you can ignore this email.`,
        html: `<p>Verify your email to finish signing up:</p><p><a href="${verifyUrl.toString()}">Verify email</a></p><p>If you didn’t request this, you can ignore this email.</p>`,
      });
      return ok("sent");
    } catch {
      // Keep provider failures opaque.
      return ok("accepted");
    }
  }
}
