import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { validateEmail, toPasswordHttpError } from "../lib/password";
import { resolveTurnstileServerConfig, verifyTurnstile } from "../lib/turnstile";
import { consumeAuthAttempt, isAuthRateLimitError } from "../lib/authRateLimit";
import { createPasswordResetToken } from "../lib/passwordReset";
import { sendResendEmail } from "../lib/emailSender";

const forgotPasswordBodySchema = z.object({
  email: Str(),
  turnstileToken: z.preprocess((value) => (value === null ? undefined : value), Str({ required: false })),
});

export class AuthForgotPassword extends OpenAPIRoute {
  schema = {
    tags: ["Auth"],
    summary: "Request a password reset email",
    request: {
      body: {
        content: {
          "application/json": {
            schema: forgotPasswordBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Request accepted",
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

    let email: string;
    try {
      email = validateEmail(data.body.email, env.ALLOWED_EMAIL_DOMAINS);
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

    if (!turnstileConfig.isLocalDevHost) {
      try {
        await consumeAuthAttempt(env.DB, `forgot_pw:${email}:${clientKey}`);
        await consumeAuthAttempt(env.DB, `forgot_pw_ip:${clientKey}`);
      } catch (error) {
        if (isAuthRateLimitError(error)) {
          c.header("Retry-After", String(error.retryAfterSec));
          return c.json({ error: "Too many password reset attempts. Please try again later." }, 429);
        }
        console.error("Forgot-password rate-limit check failed", error);
        return c.json({ error: "Unable to process this request right now. Please try again shortly." }, 503);
      }
    }

    const account = await env.DB
      .prepare(
        `SELECT id
         FROM accounts
         WHERE lower(email) = ? AND provider = 'email' AND email IS NOT NULL AND deleted_at IS NULL`
      )
      .bind(email)
      .first<{ id: string }>();

    if (!account) {
      return { success: true };
    }

    try {
      const { token } = await createPasswordResetToken(env.DB, account.id);
      const baseUrl = env.APP_BASE_URL ?? "https://tribun-ppc.com";
      const resetUrl = new URL("/reset-password", baseUrl);
      resetUrl.searchParams.set("token", token);

      await sendResendEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.EMAIL_FROM,
        to: email,
        subject: "Reset your TribunPlay password",
        text: `Use this link to reset your password:\n\n${resetUrl.toString()}\n\nIf you didn't request this, you can ignore this email.`,
        html: `<p>Use this link to reset your password:</p><p><a href="${resetUrl.toString()}">Reset password</a></p><p>If you didn't request this, you can ignore this email.</p>`,
      });
    } catch (error) {
      console.error("Forgot-password email send failed", error);
      return { success: true };
    }

    return { success: true };
  }
}
