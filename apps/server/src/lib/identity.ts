import { z } from "zod";
import type { D1Database } from "@cloudflare/workers-types";
import { getAuthIdentityFromAccessToken } from "./authSession";

export const identitySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("guest"),
    name: z.string(),
    accountId: z.string().uuid().optional(),
  }),
  z.object({
    mode: z.literal("token"),
    accessToken: z.string().min(1),
  }),
]);

export type IdentityInput = z.infer<typeof identitySchema>;
type GuestIdentityInput = { mode: "guest"; name: string; accountId?: string };

export type ResolvedIdentity = {
  accountId: string;
  name: string;
  email: string | null;
  mode: "guest" | "token";
  provider: "guest" | "google" | "email";
  providerSubject: string | null;
};

class IdentityError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type GoogleTokenInfo = {
  aud?: string;
  sub?: string;
  email?: string;
  name?: string;
  given_name?: string;
  exp?: string;
};

const GUEST_NAME_MAX_LENGTH = 40;

const normalizeName = (value: string): string => value.trim().replace(/\s+/g, " ");

const validateName = (value: string): string => {
  const normalized = normalizeName(value);
  if (!normalized) {
    throw new IdentityError(400, "Name is required");
  }
  if (normalized.length > GUEST_NAME_MAX_LENGTH) {
    throw new IdentityError(400, `Name must be at most ${GUEST_NAME_MAX_LENGTH} characters`);
  }
  return normalized;
};

const verifyGoogleIdToken = async (idToken: string, expectedAudience: string): Promise<GoogleTokenInfo> => {
  const tokenInfoUrl = new URL("https://oauth2.googleapis.com/tokeninfo");
  tokenInfoUrl.searchParams.set("id_token", idToken);

  const response = await fetch(tokenInfoUrl.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new IdentityError(401, "Invalid Google sign-in token");
  }

  const payload = (await response.json()) as GoogleTokenInfo;

  if (payload.aud !== expectedAudience) {
    throw new IdentityError(401, "Google token audience mismatch");
  }

  if (!payload.sub) {
    throw new IdentityError(401, "Google token missing subject");
  }

  const expSeconds = Number(payload.exp ?? 0);
  if (!Number.isFinite(expSeconds) || expSeconds <= Math.floor(Date.now() / 1000)) {
    throw new IdentityError(401, "Google token has expired");
  }

  return payload;
};

const upsertGuestAccount = async (db: D1Database, identity: GuestIdentityInput): Promise<ResolvedIdentity> => {
  const nowIso = new Date().toISOString();
  const name = validateName(identity.name);
  let accountId = identity.accountId ?? "";

  if (accountId) {
    const existing = await db
      .prepare("SELECT id FROM accounts WHERE id = ? AND provider = 'guest'")
      .bind(accountId)
      .first<{ id: string }>();

    if (existing?.id) {
      await db.prepare("UPDATE accounts SET name = ?, updated_at = ? WHERE id = ?").bind(name, nowIso, existing.id).run();

      return {
        accountId: existing.id,
        name,
        email: null,
        mode: "guest",
        provider: "guest",
        providerSubject: null,
      };
    }
  }

  accountId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO accounts (id, provider, provider_subject, name, email, created_at, updated_at)
       VALUES (?, 'guest', NULL, ?, NULL, ?, ?)`
    )
    .bind(accountId, name, nowIso, nowIso)
    .run();

  return {
    accountId,
    name,
    email: null,
    mode: "guest",
    provider: "guest",
    providerSubject: null,
  };
};

export const resolveGoogleIdentity = async (
  db: D1Database,
  googleClientId: string | undefined,
  googleIdToken: string,
): Promise<{ accountId: string; name: string; email: string; provider: "google"; providerSubject: string }> => {
  if (!googleClientId) {
    throw new IdentityError(503, "Google sign-in is not configured");
  }

  const tokenPayload = await verifyGoogleIdToken(googleIdToken, googleClientId);
  const nowIso = new Date().toISOString();

  const providerSubject = tokenPayload.sub!;
  const email = tokenPayload.email?.trim().toLowerCase() ?? "";
  if (!email) {
    throw new IdentityError(400, "Google account email is unavailable");
  }

  const rawName = tokenPayload.name || tokenPayload.given_name || "";
  const name = validateName(rawName);

  const existing = await db
    .prepare("SELECT id FROM accounts WHERE provider = 'google' AND provider_subject = ?")
    .bind(providerSubject)
    .first<{ id: string }>();

  const accountId = existing?.id ?? crypto.randomUUID();

  if (existing?.id) {
    await db
      .prepare("UPDATE accounts SET name = ?, email = ?, updated_at = ? WHERE id = ?")
      .bind(name, email, nowIso, existing.id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO accounts (id, provider, provider_subject, name, email, created_at, updated_at)
         VALUES (?, 'google', ?, ?, ?, ?, ?)`
      )
      .bind(accountId, providerSubject, name, email, nowIso, nowIso)
      .run();
  }

  return {
    accountId,
    name,
    email,
    provider: "google",
    providerSubject,
  };
};

export const resolveIdentity = async (
  db: D1Database,
  tokenSecret: string | undefined,
  rawIdentity: unknown,
): Promise<ResolvedIdentity> => {
  const parsed = identitySchema.safeParse(rawIdentity);
  if (!parsed.success) {
    throw new IdentityError(400, "Invalid identity payload");
  }

  if (parsed.data.mode === "guest") {
    return upsertGuestAccount(db, parsed.data as GuestIdentityInput);
  }

  const tokenIdentity = await getAuthIdentityFromAccessToken({
    db,
    tokenSecret,
    accessToken: parsed.data.accessToken,
  });

  return {
    accountId: tokenIdentity.accountId,
    name: tokenIdentity.name,
    email: tokenIdentity.email,
    mode: "token",
    provider: "email",
    providerSubject: null,
  };
};

export const toHttpError = (error: unknown): { status: number; message: string } => {
  if (error instanceof IdentityError) {
    return { status: error.status, message: error.message };
  }

  if (error instanceof Error) {
    if (error.message.toLowerCase().includes("token")) {
      return { status: 401, message: "Invalid or expired session" };
    }
    return { status: 500, message: error.message };
  }

  return { status: 500, message: "Unknown identity error" };
};
