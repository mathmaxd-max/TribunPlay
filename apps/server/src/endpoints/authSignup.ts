import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { issueAuthSession, toAuthSessionHttpError } from "../lib/authSession";
import {
  hashPassword,
  toPasswordHttpError,
  validateAccountName,
  validateEmail,
  validatePassword,
} from "../lib/password";

const signupBodySchema = z.object({
  email: Str(),
  password: Str(),
  name: Str(),
});

export class AuthSignup extends OpenAPIRoute {
  schema = {
    tags: ["Auth"],
    summary: "Create an email/password account",
    request: {
      body: {
        content: {
          "application/json": {
            schema: signupBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Returns authenticated identity and session",
        content: {
          "application/json": {
            schema: z.object({
              identity: z.object({
                mode: z.literal("token"),
                accountId: Str(),
                name: Str(),
                email: Str(),
              }),
              session: z.object({
                accessToken: Str(),
                refreshToken: Str(),
                expiresInSec: z.number(),
                expiresAtMs: z.number(),
              }),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
    const data = await this.getValidatedData<typeof this.schema>();

    let email: string;
    let password: string;
    let name: string;

    try {
      email = validateEmail(data.body.email);
      password = validatePassword(data.body.password);
      name = validateAccountName(data.body.name);
    } catch (error) {
      const normalized = toPasswordHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 500);
    }

    const existing = await env.DB
      .prepare("SELECT id FROM accounts WHERE lower(email) = ? AND provider IN ('email', 'google')")
      .bind(email)
      .first<{ id: string }>();

    if (existing?.id) {
      return c.json({ error: "Unable to create account" }, 409);
    }

    try {
      const nowIso = new Date().toISOString();
      const accountId = crypto.randomUUID();
      const passwordHash = await hashPassword(password);

      await env.DB.batch([
        env.DB
          .prepare(
            `INSERT INTO accounts (id, provider, provider_subject, name, email, created_at, updated_at)
             VALUES (?, 'email', NULL, ?, ?, ?, ?)`
          )
          .bind(accountId, name, email, nowIso, nowIso),
        env.DB
          .prepare(
            `INSERT INTO account_credentials (account_id, password_hash, hash_algo, created_at, updated_at, last_login_at)
             VALUES (?, ?, 'bcrypt', ?, ?, ?)`
          )
          .bind(accountId, passwordHash, nowIso, nowIso, nowIso),
      ]);

      return issueAuthSession({
        db: env.DB,
        tokenSecret: env.AUTH_TOKEN_SECRET,
        account: { id: accountId, name, email },
      });
    } catch (error) {
      const normalized = toAuthSessionHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 401 | 403 | 500 | 503);
    }
  }
}
