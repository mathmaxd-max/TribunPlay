import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { getAuthIdentityFromAccessToken, toAuthSessionHttpError } from "../lib/authSession";

const setupLibraryUpdateSchema = z.object({
  name: z.string().min(1).max(80),
});

const parseBearerToken = (headerValue: string | undefined): string | null => {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
};

export class SetupLibraryUpdate extends OpenAPIRoute {
  schema = {
    tags: ["Setup Library"],
    summary: "Rename a setup-library entry for the authenticated account",
    request: {
      params: z.object({
        itemId: z.string().min(1),
      }),
      body: {
        content: {
          "application/json": {
            schema: setupLibraryUpdateSchema,
          },
        },
      },
    },
    responses: {
      "200": { description: "Updated setup-library item" },
      "400": { description: "Invalid payload" },
      "401": { description: "Unauthorized" },
      "404": { description: "Not found" },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const body = data.body;
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

    const name = body.name.trim();
    if (!name) {
      return c.json({ error: "Name is required" }, 400);
    }

    const existing = await c.env.DB
      .prepare(
        `SELECT id, name, hash, army_size, tribun_height, created_at, updated_at
         FROM setup_library_items
         WHERE account_id = ? AND id = ?
         LIMIT 1`,
      )
      .bind(identity.accountId, itemId)
      .first<{
        id: string;
        name: string;
        hash: string;
        army_size: number;
        tribun_height: 1 | 2 | 3;
        created_at: string;
        updated_at: string;
      }>();

    if (!existing) {
      return c.json({ error: "Setup-library item not found." }, 404);
    }

    const nowIso = new Date().toISOString();
    await c.env.DB
      .prepare(
        `UPDATE setup_library_items
         SET name = ?, updated_at = ?
         WHERE account_id = ? AND id = ?`,
      )
      .bind(name, nowIso, identity.accountId, itemId)
      .run();

    return {
      item: {
        id: existing.id,
        name,
        hash: existing.hash,
        armySize: existing.army_size,
        tribunHeight: existing.tribun_height,
        createdAt: existing.created_at,
        updatedAt: nowIso,
      },
    };
  }
}
