import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { getAuthIdentityFromAccessToken, toAuthSessionHttpError } from "../lib/authSession";
import { normalizeAccountPreferences } from "../lib/accountPreferences";
import { accountPreferencesSchema } from "./accountPreferences";

const RENAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

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

export class AccountStatus extends OpenAPIRoute {
  schema = {
    tags: ["Account"],
    summary: "Get account management status",
    responses: {
      "200": {
        description: "Account status",
        content: {
          "application/json": {
            schema: z.object({
              name: z.string(),
              email: z.string(),
              provider: z.enum(["email", "google"]),
              canRenameNow: z.boolean(),
              nextRenameAllowedAt: z.string().nullable(),
              lastNameRenameAt: z.string().nullable(),
              preferences: accountPreferencesSchema,
              hasStoredPreferences: z.boolean(),
            }),
          },
        },
      },
      "401": { description: "Unauthorized" },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
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

    const account = await env.DB
      .prepare(
        `SELECT name, email, provider, last_name_rename_at, preferences_json
         FROM accounts
         WHERE id = ? AND deleted_at IS NULL`
      )
      .bind(identity.accountId)
      .first<{
        name: string;
        email: string;
        provider: "guest" | "google" | "email";
        last_name_rename_at: string | null;
        preferences_json: string | null;
      }>();

    if (!account || account.provider === "guest") {
      return c.json({ error: "Account settings are unavailable for guest accounts." }, 403);
    }

    const nextRenameAllowedAt = computeNextAllowedRenameAt(account.last_name_rename_at);
    const canRenameNow = !nextRenameAllowedAt || Date.parse(nextRenameAllowedAt) <= Date.now();

    return {
      name: account.name,
      email: account.email,
      provider: account.provider,
      canRenameNow,
      nextRenameAllowedAt,
      lastNameRenameAt: account.last_name_rename_at,
      preferences: normalizeAccountPreferences(account.preferences_json),
      hasStoredPreferences: account.preferences_json !== null && account.preferences_json !== "",
    };
  }
}
