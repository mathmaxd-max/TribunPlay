import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { consumeEmailVerificationToken } from "../lib/emailVerification";

const verifyEmailBodySchema = z.object({
  token: Str(),
});

export class AuthVerifyEmail extends OpenAPIRoute {
  schema = {
    tags: ["Auth"],
    summary: "Verify an email address using a one-time token",
    request: {
      body: {
        content: {
          "application/json": {
            schema: verifyEmailBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Verification result",
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

    try {
      await consumeEmailVerificationToken(env.DB, data.body.token);
      return { success: true };
    } catch {
      return c.json({ error: "Invalid or expired verification link" }, 400);
    }
  }
}

