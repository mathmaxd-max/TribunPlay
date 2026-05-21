import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { getAuthIdentityFromAccessToken, toAuthSessionHttpError } from "../lib/authSession";
import {
	mergePreferencesPatch,
	normalizeAccountPreferences,
	serializeAccountPreferences,
	type AccountPreferences,
	type AccountPreferencesPatch,
} from "../lib/accountPreferences";

export const accountPreferencesSchema = z.object({
	singleClickCancelReselect: z.boolean(),
	preferredSeatColor: z.enum(["black", "white", "none"]),
	streamerMode: z.boolean(),
	boardSfx: z.object({
		muted: z.boolean(),
		volume: z.number(),
	}),
});

export const accountPreferencesPatchSchema = z
	.object({
		singleClickCancelReselect: z.boolean().optional(),
		preferredSeatColor: z.enum(["black", "white", "none"]).optional(),
		streamerMode: z.boolean().optional(),
		boardSfx: z
			.object({
				muted: z.boolean().optional(),
				volume: z.number().optional(),
			})
			.optional(),
	})
	.refine((value) => Object.keys(value).length > 0, { message: "At least one preference field is required." });

const parseBearerToken = (headerValue: string | undefined): string | null => {
	if (!headerValue) return null;
	const trimmed = headerValue.trim();
	if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
	const token = trimmed.slice(7).trim();
	return token.length > 0 ? token : null;
};

const loadAccountPreferences = async (
	db: AppContext["env"]["DB"],
	accountId: string,
): Promise<{ preferences: AccountPreferences; preferencesJson: string | null } | null> => {
	const row = await db
		.prepare(
			`SELECT provider, preferences_json
       FROM accounts
       WHERE id = ? AND deleted_at IS NULL`,
		)
		.bind(accountId)
		.first<{ provider: string; preferences_json: string | null }>();

	if (!row || row.provider === "guest") return null;

	return {
		preferences: normalizeAccountPreferences(row.preferences_json),
		preferencesJson: row.preferences_json,
	};
};

export class AccountPreferencesPatch extends OpenAPIRoute {
	schema = {
		tags: ["Account"],
		summary: "Update account preferences",
		request: {
			body: {
				content: {
					"application/json": {
						schema: accountPreferencesPatchSchema,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Updated preferences",
				content: {
					"application/json": {
						schema: z.object({
							preferences: accountPreferencesSchema,
						}),
					},
				},
			},
			401: { description: "Unauthorized" },
			403: { description: "Forbidden" },
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

		const data = await this.getValidatedData<typeof this.schema>();
		const patch = data.body as AccountPreferencesPatch;

		const loaded = await loadAccountPreferences(env.DB, identity.accountId);
		if (!loaded) {
			return c.json({ error: "Account settings are unavailable for guest accounts." }, 403);
		}

		const merged = mergePreferencesPatch(loaded.preferences, patch);
		const nowIso = new Date().toISOString();
		const serialized = serializeAccountPreferences(merged);

		await env.DB
			.prepare("UPDATE accounts SET preferences_json = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
			.bind(serialized, nowIso, identity.accountId)
			.run();

		return { preferences: merged };
	}
}
