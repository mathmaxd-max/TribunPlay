import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { resolveGoogleIdentity, toHttpError } from "../lib/identity";
import { issueAuthSession, toAuthSessionHttpError } from "../lib/authSession";
import { verifyTurnstile } from "../lib/turnstile";
import { consumeAuthAttempt, resetAuthAttempt } from "../lib/authRateLimit";

const googleBodySchema = z.object({
  googleIdToken: Str(),
  turnstileToken: Str({ required: false }),
});

export class AuthGoogle extends OpenAPIRoute {
  schema = {
    tags: ["Auth"],
    summary: "Exchange a Google ID token for an app session",
    request: {
      body: {
        content: {
          "application/json": {
            schema: googleBodySchema,
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

    const clientIp = c.req.header("CF-Connecting-IP") ?? "unknown";

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

    const ipBucket = `google_ip:${clientIp}`;
    try {
      // M01 additional non-invasive bot protection: per-IP limiting for OAuth token exchange.
      await consumeAuthAttempt(env.DB, ipBucket);
    } catch {
      return c.json({ error: "Too many sign-in attempts. Please try again later." }, 429);
    }

    let googleIdentity;
    try {
      googleIdentity = await resolveGoogleIdentity(env.DB, env.GOOGLE_CLIENT_ID, data.body.googleIdToken);
    } catch (error) {
      // Failed verification attempts should still count against rate limits.
      const normalized = toHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 401 | 403 | 500 | 503);
    }

    try {
      const result = await issueAuthSession({
        db: env.DB,
        tokenSecret: env.AUTH_TOKEN_SECRET,
        account: {
          id: googleIdentity.accountId,
          name: googleIdentity.name,
          email: googleIdentity.email,
        },
      });
      await resetAuthAttempt(env.DB, ipBucket);
      return result;
    } catch (error) {
      const normalized = toAuthSessionHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 401 | 403 | 500 | 503);
    }
  }
}
