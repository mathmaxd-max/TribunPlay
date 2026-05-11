import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";

/**
 * Deletes email/password ("local") accounts and their dependent rows.
 *
 * Why this exists:
 * - Migrations are one-time; this cleanup is sometimes needed repeatedly in dev/staging.
 * - Some tables referencing `accounts` do not use ON DELETE CASCADE (by design / legacy),
 *   so we must delete dependent rows first.
 *
 * Safety:
 * - Protected by `ADMIN_PURGE_KEY` and `X-Admin-Key` header.
 * - Only deletes accounts with `provider = 'email'`.
 */
export class AdminPurgeLocalAccounts extends OpenAPIRoute {
  schema = {
    tags: ["Admin"],
    summary: "Delete all email/password accounts (dev/staging maintenance)",
    request: {
      headers: z.object({
        "x-admin-key": Str({ required: true }),
      }),
    },
    responses: {
      "200": {
        description: "Deleted local accounts and dependent rows",
        content: {
          "application/json": {
            schema: z.object({
              ok: z.boolean(),
              deleted: z.object({
                gameParticipants: z.number(),
                setupLibraryItems: z.number(),
                accounts: z.number(),
              }),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
    if (!env.ADMIN_PURGE_KEY) {
      return c.json({ error: "Admin purge is not configured" }, 503);
    }

    const data = await this.getValidatedData<typeof this.schema>();
    const suppliedKey =
      (data.headers as any)["x-admin-key"] ?? c.req.header("X-Admin-Key") ?? c.req.header("x-admin-key") ?? "";

    if (suppliedKey !== env.ADMIN_PURGE_KEY) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Delete in dependency order; D1 migrations/queries are atomic without explicit BEGIN/COMMIT.
    const deleteParticipants = await env.DB.prepare(
      `DELETE FROM game_participants
       WHERE account_id IN (SELECT id FROM accounts WHERE provider = 'email')`
    ).run();

    const deleteSetups = await env.DB.prepare(
      `DELETE FROM setup_library_items
       WHERE account_id IN (SELECT id FROM accounts WHERE provider = 'email')`
    ).run();

    const deleteAccounts = await env.DB.prepare(`DELETE FROM accounts WHERE provider = 'email'`).run();

    return c.json({
      ok: true,
      deleted: {
        gameParticipants: deleteParticipants.meta.changes ?? 0,
        setupLibraryItems: deleteSetups.meta.changes ?? 0,
        accounts: deleteAccounts.meta.changes ?? 0,
      },
    });
  }
}

