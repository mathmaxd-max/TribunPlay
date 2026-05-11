import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { getAuthIdentityFromAccessToken, toAuthSessionHttpError } from "../lib/authSession";
import { toPasswordHttpError, validateAccountName } from "../lib/password";

const RENAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

const renameAccountBodySchema = z.object({
  name: Str(),
});

const parseBearerToken = (headerValue: string | undefined): string | null => {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
};

const computeNextAllowedRenameAt = (lastNameRenameAt: string | null): string | null => {
  if (!lastNameRenameAt) return null;
  const lastMs = Date.parse(lastNameRenameAt);
  if (!Number.isFinite(lastMs)) return null;
  return new Date(lastMs + RENAME_COOLDOWN_MS).toISOString();
};

export class AccountRename extends OpenAPIRoute {
  schema = {
    tags: ["Account"],
    summary: "Rename the authenticated account (30-day cooldown)",
    request: {
      body: {
        content: {
          "application/json": {
            schema: renameAccountBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Rename result",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              name: z.string(),
              canRenameNow: z.boolean(),
              nextRenameAllowedAt: z.string().nullable(),
              lastNameRenameAt: z.string().nullable(),
            }),
          },
        },
      },
      "401": { description: "Unauthorized" },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
    const data = await this.getValidatedData<typeof this.schema>();

    const accessToken = parseBearerToken(c.req.header("Authorization"));
    if (!accessToken) {
      return c.json({ error: "Missing bearer token" }, 401);
    }

    let identity;
    try {
      identity = await getAuthIdentityFromAccessToken({
        db: env.DB,
        tokenSecret: env.AUTH_TOKEN_SECRET,
        accessToken,
      });
    } catch (error) {
      const normalized = toAuthSessionHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 401 | 500);
    }

    let nextName: string;
    try {
      nextName = validateAccountName(data.body.name);
    } catch (error) {
      const normalized = toPasswordHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 500);
    }

    const account = await env.DB
      .prepare(
        `SELECT id, provider, name, last_name_rename_at
         FROM accounts
         WHERE id = ? AND deleted_at IS NULL`
      )
      .bind(identity.accountId)
      .first<{ id: string; provider: "guest" | "google" | "email"; name: string; last_name_rename_at: string | null }>();

    if (!account) {
      return c.json({ error: "Account not found" }, 404);
    }

    if (account.provider === "guest") {
      return c.json({ error: "Guest accounts cannot be renamed." }, 403);
    }

    const nextRenameAllowedAt = computeNextAllowedRenameAt(account.last_name_rename_at);
    if (nextRenameAllowedAt && Date.parse(nextRenameAllowedAt) > Date.now()) {
      return c.json(
        {
          error: `You can rename your account again on ${nextRenameAllowedAt}.`,
          nextRenameAllowedAt,
        },
        429,
      );
    }

    if (account.name === nextName) {
      const canRenameNow = !nextRenameAllowedAt || Date.parse(nextRenameAllowedAt) <= Date.now();
      return {
        success: true,
        name: account.name,
        canRenameNow,
        nextRenameAllowedAt,
        lastNameRenameAt: account.last_name_rename_at,
      };
    }

    const nowIso = new Date().toISOString();
    await env.DB
      .prepare("UPDATE accounts SET name = ?, last_name_rename_at = ?, updated_at = ? WHERE id = ?")
      .bind(nextName, nowIso, nowIso, account.id)
      .run();

    return {
      success: true,
      name: nextName,
      canRenameNow: false,
      nextRenameAllowedAt: new Date(Date.now() + RENAME_COOLDOWN_MS).toISOString(),
      lastNameRenameAt: nowIso,
    };
  }
}
