import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { getAuthIdentityFromAccessToken, toAuthSessionHttpError } from "../lib/authSession";

const parseBearerToken = (headerValue: string | undefined): string | null => {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
};

export class SetupLibraryDelete extends OpenAPIRoute {
  schema = {
    tags: ["Setup Library"],
    summary: "Delete a setup-library entry for the authenticated account",
    request: {
      params: z.object({
        itemId: z.string().min(1),
      }),
    },
    responses: {
      "200": { description: "Deleted setup-library item" },
      "401": { description: "Unauthorized" },
      "404": { description: "Not found" },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const { itemId } = data.params;
    const accessToken = parseBearerToken(c.req.header("Authorization"));
    if (!accessToken) {
      return c.json({ error: "Missing bearer token" }, 401);
    }

    let identity;
    try {
      identity = await getAuthIdentityFromAccessToken({
        db: c.env.DB,
        tokenSecret: c.env.AUTH_TOKEN_SECRET,
        accessToken,
      });
    } catch (error) {
      const normalized = toAuthSessionHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 401 | 500);
    }

    const existing = await c.env.DB
      .prepare(
        `SELECT id
         FROM setup_library_items
         WHERE account_id = ? AND id = ?
         LIMIT 1`,
      )
      .bind(identity.accountId, itemId)
      .first<{ id: string }>();
    if (!existing) {
      return c.json({ error: "Setup-library item not found." }, 404);
    }

    await c.env.DB
      .prepare(
        `DELETE FROM setup_library_items
         WHERE account_id = ? AND id = ?`,
      )
      .bind(identity.accountId, itemId)
      .run();

    return { success: true, itemId };
  }
}
