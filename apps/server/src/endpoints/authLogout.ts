import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { revokeRefreshToken } from "../lib/authSession";

const logoutBodySchema = z.object({
  refreshToken: Str(),
});

export class AuthLogout extends OpenAPIRoute {
  schema = {
    tags: ["Auth"],
    summary: "Revoke a refresh token",
    request: {
      body: {
        content: {
          "application/json": {
            schema: logoutBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Returns revocation status",
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

    await revokeRefreshToken(env.DB, data.body.refreshToken);
    return { success: true };
  }
}
