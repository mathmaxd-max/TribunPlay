import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { refreshAuthSession, toAuthSessionHttpError } from "../lib/authSession";

const refreshBodySchema = z.object({
  refreshToken: Str(),
});

export class AuthRefresh extends OpenAPIRoute {
  schema = {
    tags: ["Auth"],
    summary: "Refresh an authentication session",
    request: {
      body: {
        content: {
          "application/json": {
            schema: refreshBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Returns refreshed identity and session",
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

    try {
      return await refreshAuthSession({
        db: env.DB,
        tokenSecret: env.AUTH_TOKEN_SECRET,
        refreshToken: data.body.refreshToken,
      });
    } catch (error) {
      console.error("[AUTH] refresh.failed", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      const normalized = toAuthSessionHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 401 | 403 | 500 | 503);
    }
  }
}
