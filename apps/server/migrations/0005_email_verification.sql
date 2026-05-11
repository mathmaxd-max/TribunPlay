-- Email verification support for email/password accounts.
-- Stores verified state on the account and tracks one-time verification tokens (hashed) with expiry.

ALTER TABLE accounts ADD COLUMN email_verified_at TEXT;

CREATE TABLE IF NOT EXISTS auth_email_verifications (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_email_verifications_account_id
  ON auth_email_verifications(account_id);

CREATE INDEX IF NOT EXISTS idx_auth_email_verifications_expires_at
  ON auth_email_verifications(expires_at);

