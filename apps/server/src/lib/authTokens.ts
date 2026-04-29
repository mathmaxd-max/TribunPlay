import { z } from "zod";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const authTokenPayloadSchema = z.object({
  typ: z.literal("access"),
  accountId: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type AuthTokenPayload = z.infer<typeof authTokenPayloadSchema>;

class AuthTokenError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const encoder = new TextEncoder();

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

const fromHex = (value: string): Uint8Array => {
  if (value.length % 2 !== 0) {
    throw new AuthTokenError(401, "Invalid token encoding");
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    const byte = Number.parseInt(value.slice(index, index + 2), 16);
    if (!Number.isFinite(byte)) {
      throw new AuthTokenError(401, "Invalid token encoding");
    }
    bytes[index / 2] = byte;
  }
  return bytes;
};

const importHmacKey = async (secret: string): Promise<unknown> => {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
};

const safeParseSecret = (secret: string | undefined): string => {
  if (!secret || secret.length < 32) {
    throw new AuthTokenError(503, "Auth token secret is not configured");
  }
  return secret;
};

export const createAccessToken = async (args: {
  secret: string | undefined;
  accountId: string;
  email: string;
  name: string;
  nowMs?: number;
}): Promise<{ token: string; expiresInSec: number; expiresAtMs: number }> => {
  const secret = safeParseSecret(args.secret);
  const nowMs = args.nowMs ?? Date.now();
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + ACCESS_TOKEN_TTL_SECONDS;

  const payload: AuthTokenPayload = {
    typ: "access",
    accountId: args.accountId,
    email: args.email,
    name: args.name,
    iat,
    exp,
  };

  const payloadString = JSON.stringify(payload);
  const payloadEncoded = encodeURIComponent(payloadString);

  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key as any, encoder.encode(payloadEncoded));
  const signatureEncoded = toHex(new Uint8Array(signature));

  return {
    token: `${payloadEncoded}.${signatureEncoded}`,
    expiresInSec: ACCESS_TOKEN_TTL_SECONDS,
    expiresAtMs: exp * 1000,
  };
};

export const verifyAccessToken = async (
  secret: string | undefined,
  token: string,
): Promise<AuthTokenPayload> => {
  const safeSecret = safeParseSecret(secret);
  const [encodedPayload, encodedSignature] = token.split(".");

  if (!encodedPayload || !encodedSignature) {
    throw new AuthTokenError(401, "Invalid access token");
  }

  const key = await importHmacKey(safeSecret);
  const verified = await crypto.subtle.verify(
    "HMAC",
    key as any,
    fromHex(encodedSignature),
    encoder.encode(encodedPayload),
  );

  if (!verified) {
    throw new AuthTokenError(401, "Invalid access token signature");
  }

  let rawPayload: unknown;
  try {
    const decodedPayload = decodeURIComponent(encodedPayload);
    rawPayload = JSON.parse(decodedPayload);
  } catch {
    throw new AuthTokenError(401, "Invalid access token payload");
  }

  const parsed = authTokenPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new AuthTokenError(401, "Invalid access token claims");
  }

  if (parsed.data.exp <= Math.floor(Date.now() / 1000)) {
    throw new AuthTokenError(401, "Access token expired");
  }

  return parsed.data;
};

export const createRefreshToken = async (): Promise<{ token: string; hash: string; expiresAtIso: string }> => {
  const tokenBytes = new Uint8Array(48);
  crypto.getRandomValues(tokenBytes);
  const token = toHex(tokenBytes);

  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  const hash = toHex(new Uint8Array(hashBuffer));

  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString();
  return { token, hash, expiresAtIso: expiresAt };
};

export const hashRefreshToken = async (token: string): Promise<string> => {
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return toHex(new Uint8Array(hashBuffer));
};

export const toAuthTokenHttpError = (error: unknown): { status: number; message: string } => {
  if (error instanceof AuthTokenError) {
    return { status: error.status, message: error.message };
  }

  if (error instanceof Error) {
    return { status: 500, message: error.message };
  }

  return { status: 500, message: "Unknown auth token error" };
};
