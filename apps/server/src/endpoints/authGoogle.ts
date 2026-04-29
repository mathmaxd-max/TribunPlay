import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { resolveGoogleIdentity, toHttpError } from "../lib/identity";
import { issueAuthSession, toAuthSessionHttpError } from "../lib/authSession";

const googleBodySchema = z.object({
  googleIdToken: Str(),
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

    let googleIdentity;
    try {
      googleIdentity = await resolveGoogleIdentity(env.DB, env.GOOGLE_CLIENT_ID, data.body.googleIdToken);
    } catch (error) {
      const normalized = toHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 401 | 403 | 500 | 503);
    }

    try {
      return await issueAuthSession({
        db: env.DB,
        tokenSecret: env.AUTH_TOKEN_SECRET,
        account: {
          id: googleIdentity.accountId,
          name: googleIdentity.name,
          email: googleIdentity.email,
        },
      });
    } catch (error) {
      const normalized = toAuthSessionHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 401 | 403 | 500 | 503);
    }
  }
}
