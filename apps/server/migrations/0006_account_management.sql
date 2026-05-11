ALTER TABLE accounts ADD COLUMN deleted_at TEXT;
ALTER TABLE accounts ADD COLUMN last_name_rename_at TEXT;

ALTER TABLE game_participants ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_game_participants_account_deleted
  ON game_participants(account_id, deleted_at);

CREATE TABLE IF NOT EXISTS auth_password_resets (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_password_resets_account_id
  ON auth_password_resets(account_id);

CREATE INDEX IF NOT EXISTS idx_auth_password_resets_expires_at
  ON auth_password_resets(expires_at);
