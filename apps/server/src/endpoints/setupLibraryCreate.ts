import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import * as engine from "@tribunplay/engine";
import type { AppContext } from "../types";
import { getAuthIdentityFromAccessToken, toAuthSessionHttpError } from "../lib/authSession";

const setupLibraryCreateSchema = z.object({
  name: z.string().min(1).max(80),
  hash: z.string().min(1),
});

const parseBearerToken = (headerValue: string | undefined): string | null => {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
};

export class SetupLibraryCreate extends OpenAPIRoute {
  schema = {
    tags: ["Setup Library"],
    summary: "Add or rename a setup-library entry for the authenticated account",
    request: {
      body: {
        content: {
          "application/json": {
            schema: setupLibraryCreateSchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Created/updated setup-library item",
      },
      "400": { description: "Invalid setup hash or payload" },
      "401": { description: "Unauthorized" },
      "409": { description: "Setup library limit reached" },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const body = data.body;
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

    const hash = engine.normalizeSetupHash(body.hash);
    const decoded = engine.decodeCodeDetailed(hash);
    if (!decoded.ok || !decoded.setup) {
      return c.json({ error: "Invalid setup hash" }, 400);
    }
    const flippedEncoded = engine.encodePositionDetailed(engine.flipSetup(decoded.setup));
    if (!flippedEncoded.ok) {
      return c.json({ error: "Invalid setup hash" }, 400);
    }
    const flippedHash = engine.normalizeSetupHash(flippedEncoded.code);

    const name = body.name.trim();
    if (!name) {
      return c.json({ error: "Name is required" }, 400);
    }

    const nowIso = new Date().toISOString();
    const existingRow = await c.env.DB
      .prepare(
        `SELECT id, name, hash, army_size, tribun_height, created_at, updated_at
         FROM setup_library_items
         WHERE account_id = ? AND (hash = ? OR hash = ?)
         LIMIT 1`,
      )
      .bind(identity.accountId, hash, flippedHash)
      .first<{
        id: string;
        name: string;
        hash: string;
        army_size: number;
        tribun_height: 1 | 2 | 3;
        created_at: string;
        updated_at: string;
      }>();

    if (existingRow) {
      await c.env.DB
        .prepare(
          `UPDATE setup_library_items
           SET name = ?, army_size = ?, tribun_height = ?, updated_at = ?
           WHERE account_id = ? AND id = ?`,
        )
        .bind(
          name,
          decoded.setup.armySize,
          decoded.setup.tribunHeight,
          nowIso,
          identity.accountId,
          existingRow.id,
        )
        .run();
    } else {
      const countRow = await c.env.DB
        .prepare(`SELECT COUNT(*) AS count FROM setup_library_items WHERE account_id = ?`)
        .bind(identity.accountId)
        .first<{ count: number }>();
      const count = Number(countRow?.count ?? 0);
      if (count >= 2) {
        return c.json({ error: "Setup library limit reached (max 2 setups)." }, 409);
      }

      const itemId = crypto.randomUUID();
      await c.env.DB
        .prepare(
          `INSERT INTO setup_library_items (
             id, account_id, name, hash, army_size, tribun_height, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          itemId,
          identity.accountId,
          name,
          hash,
          decoded.setup.armySize,
          decoded.setup.tribunHeight,
          nowIso,
          nowIso,
        )
        .run();
    }

    const row = await c.env.DB
      .prepare(
        // Hash and its flip represent one setup identity group, so we read back either.
        `SELECT id, name, hash, army_size, tribun_height, created_at, updated_at
         FROM setup_library_items
         WHERE account_id = ? AND (hash = ? OR hash = ?)
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .bind(identity.accountId, hash, flippedHash)
      .first<{
        id: string;
        name: string;
        hash: string;
        army_size: number;
        tribun_height: 1 | 2 | 3;
        created_at: string;
        updated_at: string;
      }>();

    if (!row) {
      return c.json({ error: "Failed to persist setup-library item" }, 500);
    }

    return {
      item: {
        id: row.id,
        name: row.name,
        hash: row.hash,
        armySize: row.army_size,
        tribunHeight: row.tribun_height,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    };
  }
}
