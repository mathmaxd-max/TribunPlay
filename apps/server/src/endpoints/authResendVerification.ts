import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { validateEmail } from "../lib/password";
import { resolveTurnstileServerConfig, verifyTurnstile } from "../lib/turnstile";
import { consumeAuthAttempt } from "../lib/authRateLimit";
import { createEmailVerificationToken } from "../lib/emailVerification";
import { sendResendEmail } from "../lib/emailSender";

const resendVerificationBodySchema = z.object({
  email: Str(),
  // Older clients may send `turnstileToken: null` when CAPTCHA is disabled.
  // Treat null as "missing" so request validation doesn't hard-fail with 400.
  turnstileToken: z.preprocess((value) => (value === null ? undefined : value), Str({ required: false })),
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
        description: "Always returns success to avoid account enumeration",
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

    // Always respond 200; this endpoint must not leak whether an account exists.
    const ok = () => ({ success: true });

    let email: string;
    try {
      email = validateEmail(data.body.email);
    } catch {
      return ok();
    }

    const clientIp = c.req.header("CF-Connecting-IP") ?? "unknown";

    {
      const turnstileConfig = resolveTurnstileServerConfig({
        enabledFlag: env.TURNSTILE_ENABLED,
        configuredSecretKey: env.TURNSTILE_SECRET_KEY,
        requestUrl: c.req.url,
        hostHeader: c.req.header("Host") ?? undefined,
      });

      const captcha = await verifyTurnstile({
        enabled: turnstileConfig.enabled,
        secretKey: turnstileConfig.secretKey,
        token: data.body.turnstileToken,
        remoteIp: clientIp,
      });
      if (captcha.success === false) {
        return ok();
      }
    }

    try {
      // Per-email + per-IP style buckets. Keep separate from login/signup to avoid unexpected coupling.
      await consumeAuthAttempt(env.DB, `resend_verify:${email}:${clientIp}`);
      await consumeAuthAttempt(env.DB, `resend_verify_ip:${clientIp}`);
    } catch {
      return ok();
    }

    const account = await env.DB
      .prepare(
        `SELECT id, email_verified_at
         FROM accounts
         WHERE lower(email) = ? AND provider = 'email' AND email IS NOT NULL`
      )
      .bind(email)
      .first<{ id: string; email_verified_at: string | null }>();

    if (!account || account.email_verified_at) {
      return ok();
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
    } catch {
      // Swallow errors to keep response non-enumerating and avoid leaking provider failures.
      return ok();
    }

    return ok();
  }
}
