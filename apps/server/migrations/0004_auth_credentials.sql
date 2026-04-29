PRAGMA foreign_keys = OFF;

-- Expand accounts provider check to support email-password accounts.
ALTER TABLE accounts RENAME TO accounts_old;
ALTER TABLE game_participants RENAME TO game_participants_old;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_subject TEXT,
  name TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (provider IN ('guest', 'google', 'email'))
);

INSERT INTO accounts (id, provider, provider_subject, name, email, created_at, updated_at)
SELECT id, provider, provider_subject, name, email, created_at, updated_at
FROM accounts_old;

CREATE TABLE IF NOT EXISTS game_participants (
  game_id TEXT NOT NULL,
  seat TEXT NOT NULL,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (game_id, seat),
  FOREIGN KEY (game_id) REFERENCES games(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  CHECK (seat IN ('black', 'white'))
);

INSERT INTO game_participants (game_id, seat, account_id, name, email, created_at, updated_at)
SELECT game_id, seat, account_id, name, email, created_at, updated_at
FROM game_participants_old;

DROP TABLE game_participants_old;
DROP TABLE accounts_old;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_provider_subject
  ON accounts(provider, provider_subject);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_auth_email
  ON accounts(lower(email))
  WHERE provider IN ('google', 'email') AND email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_game_participants_account_id
  ON game_participants(account_id);

CREATE TABLE IF NOT EXISTS account_credentials (
  account_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  hash_algo TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  replaced_by_token_id TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (replaced_by_token_id) REFERENCES auth_refresh_tokens(id)
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_account_id
  ON auth_refresh_tokens(account_id);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_expires_at
  ON auth_refresh_tokens(expires_at);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  blocked_until TEXT,
  last_attempt_at TEXT NOT NULL
);

PRAGMA foreign_keys = ON;
