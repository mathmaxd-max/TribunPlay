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
            schema: z.object({
              success: z.boolean(),
              result: z.enum(["verified", "already_verified", "invalid_or_expired"]),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
    const data = await this.getValidatedData<typeof this.schema>();

    const result = await consumeEmailVerificationToken(env.DB, data.body.token);
    return { success: true, result: result.result };
  }
}
