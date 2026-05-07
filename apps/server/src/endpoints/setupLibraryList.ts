import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { getAuthIdentityFromAccessToken, toAuthSessionHttpError } from "../lib/authSession";

type SetupLibraryRow = {
  id: string;
  name: string;
  hash: string;
  army_size: number;
  tribun_height: 1 | 2 | 3;
  created_at: string;
  updated_at: string;
};

const parseBearerToken = (headerValue: string | undefined): string | null => {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
};

export class SetupLibraryList extends OpenAPIRoute {
  schema = {
    tags: ["Setup Library"],
    summary: "List setup-library entries for the authenticated account",
    responses: {
      "200": {
        description: "Setup library list",
        content: {
          "application/json": {
            schema: z.object({
              items: z.array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  hash: z.string(),
                  armySize: z.number(),
                  tribunHeight: z.union([z.literal(1), z.literal(2), z.literal(3)]),
                  createdAt: z.string(),
                  updatedAt: z.string(),
                }),
              ),
            }),
          },
        },
      },
      "401": { description: "Unauthorized" },
    },
  };

  async handle(c: AppContext) {
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

    const rows = await c.env.DB
      .prepare(
        `SELECT id, name, hash, army_size, tribun_height, created_at, updated_at
         FROM setup_library_items
         WHERE account_id = ?
         ORDER BY updated_at DESC, created_at DESC`,
      )
      .bind(identity.accountId)
      .all<SetupLibraryRow>();

    return {
      items: (rows.results ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        hash: row.hash,
        armySize: row.army_size,
        tribunHeight: row.tribun_height,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  }
}
