ALTER TABLE games ADD COLUMN setup_config_json TEXT;
ALTER TABLE games ADD COLUMN setup_state_json TEXT;

CREATE TABLE IF NOT EXISTS setup_library_items (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  hash TEXT NOT NULL,
  army_size INTEGER NOT NULL,
  tribun_height INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  CHECK (tribun_height IN (1, 2, 3))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_setup_library_account_hash
  ON setup_library_items(account_id, hash);

CREATE INDEX IF NOT EXISTS idx_setup_library_account_name
  ON setup_library_items(account_id, name);
