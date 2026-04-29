CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_subject TEXT,
  name TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (provider IN ('guest', 'google'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_provider_subject
  ON accounts(provider, provider_subject);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_google_email
  ON accounts(email)
  WHERE provider = 'google' AND email IS NOT NULL;

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

CREATE INDEX IF NOT EXISTS idx_game_participants_account_id
  ON game_participants(account_id);
